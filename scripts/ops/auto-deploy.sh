#!/usr/bin/env bash
# auto-deploy.sh — poller auto-deploy untuk Mac mini (dipanggil periodik oleh
# launchd: infra/launchd/com.wrg.autodeploy.plist). Tanpa GitHub runner / tanpa
# scope token: cukup script ini + 1 launchd job di server.
#
# Logika: fetch origin/main → kalau maju → deploy KODE (deploy-prod.sh --yes
# --skip-migrate). Migrasi DB TIDAK auto-apply (alert-only, prinsip MIGRATIONS.md)
# — kalau ada yg pending, di-LOG + ALERT WA LOUD (gate migrasi); apply manual.
# Idempoten, lockdir anti-tumpang-tindih, semua ter-log. Promote dev→main →
# dalam <interval> menit server otomatis ke versi baru.
#
# HANYA menyentuh wrg-prod-api/web (via deploy-prod.sh). Python legacy (8090–8092)
# & wa-bridge TIDAK pernah disentuh.
#
# GATE MIGRASI (biar deploy migrasi tidak lagi "silent break"):
#   - deteksi migrasi pending dg banding daftar file di origin/main vs tabel
#     schema_migrations prod (PRE-pull → migrasi baru yg belum masuk working tree
#     tetap kedeteksi; deteksi lama baca working tree lama → luput).
#   - ada pending → kirim ALERT WA (bukan cuma log). Edge-trigger via state file
#     supaya tidak spam tiap siklus utk set yg sama.
#   - default tetap alert-only (deploy kode jalan terus). Set
#     WRG_DEPLOY_BLOCK_ON_PENDING=1 untuk MENAHAN deploy kode sampai migrasi
#     di-apply (cegah kode yg 500 sampai schema siap).
#
# Env opsional: WRG_PROD_DIR (default ~/DevWRG/wrg-os), WRG_DEPLOY_LOG,
#   WRG_DEPLOY_BLOCK_ON_PENDING (0/1). Tujuan alert WA dibaca dari .env.prod
#   key WRG_DEPLOY_ALERT_TO (nomor/JID; kalau kosong → alert WA dilewati, log saja).
set -euo pipefail

DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
LOG="${WRG_DEPLOY_LOG:-$HOME/DevWRG/ops/auto-deploy.log}"
LOCKDIR="/tmp/wrg-auto-deploy.lockd"
INIT_DIR="infra/postgres/init"
STATE="$HOME/DevWRG/ops/.pending-migrations.state"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

mkdir -p "$(dirname "$LOG")"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }

# Baca 1 key dari .env.prod (tanpa bocorin ke log). Kosong kalau tak ada.
prod_env() { grep -E "^$1=" "$DIR/.env.prod" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

# Migrasi pending = file *.sql di origin/main yg belum tercatat di schema_migrations
# prod (owner socket, sama spt migrate.sh --prod). Echo basename per baris. Kalau DB
# tak terjangkau / tabel belum ada → echo kosong (jangan alert palsu "semua pending").
detect_pending() {
  local db url files applied base
  db="$(prod_env DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#')"; db="${db:-wrg_os_prod}"
  url="postgres:///$db"
  files="$(git ls-tree -r --name-only origin/main -- "$INIT_DIR" 2>/dev/null | grep '\.sql$' | while IFS= read -r p; do basename "$p"; done | sort)"
  [ -z "$files" ] && return 0
  applied="$(psql "$url" -At -c "SELECT filename FROM schema_migrations" 2>/dev/null)" || return 0
  while IFS= read -r base; do
    [ -z "$base" ] && continue
    grep -qxF "$base" <<<"$applied" || echo "$base"
  done <<<"$files"
}

# Kirim alert WA lewat gateway openclaw (WA_SEND_URL + x-wa-secret dari .env.prod).
# Tujuan = arg $1 (dari WRG_DEPLOY_ALERT_TO). Tidak pernah menggagalkan deploy.
wa_alert() {
  local to="$1" msg="$2" url sec
  url="$(prod_env WA_SEND_URL)"; sec="$(prod_env WA_SEND_SECRET)"
  if [ -z "$url" ] || [ -z "$to" ]; then
    log "   (alert WA dilewati — WA_SEND_URL / WRG_DEPLOY_ALERT_TO belum di-set di .env.prod)"
    return 0
  fi
  WA_URL="$url" WA_SEC="$sec" WA_TO="$to" WA_MSG="$msg" python3 - >>"$LOG" 2>&1 <<'PY' || log "   (alert WA gagal kirim — cek gateway)"
import os, json, urllib.request
url, sec = os.environ["WA_URL"], os.environ.get("WA_SEC", "")
to, msg = os.environ["WA_TO"], os.environ["WA_MSG"]
h = {"content-type": "application/json"}
if sec:
    h["x-wa-secret"] = sec
req = urllib.request.Request(url, data=json.dumps({"to": to, "message": msg}).encode(), headers=h)
r = urllib.request.urlopen(req, timeout=15)
print(f"   alert WA terkirim (HTTP {r.status}) → {to}")
PY
}

[ -d "$DIR/.git" ] || { log "ERROR repo prod tak ada di $DIR (set WRG_PROD_DIR)"; exit 1; }
cd "$DIR"

# Lockdir (mkdir atomik — portable, macOS tak punya flock).
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  log "skip: deploy lain masih jalan ($LOCKDIR)"; exit 0
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

BR="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BR" != "main" ]; then log "skip: branch '$BR' (bukan main)"; exit 0; fi

git fetch --quiet origin main || { log "fetch gagal — coba lagi nanti"; exit 0; }
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" = "$REMOTE" ]; then exit 0; fi   # tak ada yg baru → diam

log "main maju ${LOCAL:0:7} → ${REMOTE:0:7} — deploy KODE + AUTO-APPLY migrasi (backup)"

# ── GATE MIGRASI: deteksi migrasi pending (origin/main vs schema_migrations prod).
# Sejak 2026-07-16: migrasi AUTO-APPLY (pg_dump backup dulu) via deploy-prod.sh --yes,
# TIDAK lagi alert-only. Alasan: manual-apply sering kelewat (050/051-053/056 → fitur
# 500 berjam-jam, 4x) walau gate WA fire. WA alert tetap dikirim sbg REKAM ("auto-applying").
# Escape hatch: set WRG_DEPLOY_BLOCK_ON_PENDING=1 → deploy DITAHAN, apply manual (utk migrasi destruktif).
PEND="$(detect_pending || true)"
if [ -n "$PEND" ]; then
  N="$(printf '%s\n' "$PEND" | grep -c . || true)"
  PLIST="$(printf '%s ' $PEND)"
  log "⚠️ MIGRASI PENDING ($N) → AUTO-APPLY (backup): $PLIST"

  # edge-trigger: hanya kirim WA kalau set pending BERUBAH dari siklus terakhir
  CUR="$(printf '%s\n' "$PEND" | sort | tr '\n' ',')"
  PREV=""; [ -f "$STATE" ] && PREV="$(cat "$STATE" 2>/dev/null || true)"
  if [ "$CUR" != "$PREV" ]; then
    mkdir -p "$(dirname "$STATE")"; printf '%s' "$CUR" >"$STATE"
    wa_alert "$(prod_env WRG_DEPLOY_ALERT_TO)" "🟠 WRG-OS PROD — $N migrasi DB PENDING → AUTO-APPLY (pg_dump backup dulu) oleh deploy ini.
File: $PLIST
Kalau ada yg destruktif & tak boleh auto: set WRG_DEPLOY_BLOCK_ON_PENDING=1 (deploy ditahan, apply manual).
[main ${LOCAL:0:7}→${REMOTE:0:7}]"
  else
    log "   (set pending sama spt siklus lalu — alert WA tidak diulang)"
  fi

  if [ "${WRG_DEPLOY_BLOCK_ON_PENDING:-0}" = 1 ]; then
    log "   ⛔ WRG_DEPLOY_BLOCK_ON_PENDING=1 → deploy DITAHAN (auto-apply di-skip); apply manual saat siap."
    exit 0
  fi
  log "   → lanjut deploy + auto-apply migrasi (pg_dump backup)."
else
  # tak ada pending → bersihkan state supaya pending BARU berikutnya tetap ter-alert
  [ -f "$STATE" ] && rm -f "$STATE"
fi

# Deploy penuh: pull → build → migrasi (pg_dump backup) → restart. Auto-apply sejak 2026-07-16.
# deploy-prod.sh --yes: confirm() auto-yes → migrate.sh --prod --backup non-interaktif, urutan aman.
if bash scripts/ops/deploy-prod.sh --yes >>"$LOG" 2>&1; then
  log "deploy OK (kode+migrasi) → $(git rev-parse --short HEAD)"
else
  log "deploy GAGAL (cek log di atas) — akan dicoba lagi tiap interval"
fi
