#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-harian.sh — cadangan harian database produksi, terenkripsi, ke Google Drive.
#
# Latar (4 Nov 2026): wrg_os_prod TIDAK punya cadangan terjadwal — satu-satunya salinan
# adalah dump predeploy (hanya saat deploy bermigrasi) di disk yang SAMA dengan datanya.
# Tahap 2a rancangan server penyimpanan kedua (prioritas Direktur 20 Okt, Keputusan 1).
#
# Alur: pg_dump -Fc → pg_restore -l (dump terbaca) → openssl AES-256 (kunci di
# ~/.wrg-os/secrets/backup-key) → unggah ke folder Drive "WRG-OS Cadangan Database"
# (scripts/ops/gdrive-unggah.mjs, OAuth GDRIVE_OAUTH_FILE dari .env.prod) → retensi
# lokal 7 hari, Drive 30 hari (ke sampah Drive, masih bisa dipulihkan).
# Minggu (atau --uji-pulih): dump dipulihkan ke DB sementara wrg_os_uji_pulih, jumlah
# tabel + baris tabel kunci dibandingkan dengan prod, lalu DB sementara dihapus.
# Gagal di langkah mana pun → WA ke DISK_ALERT_TO / WRG_DEPLOY_ALERT_TO (pola disk-watch).
#
# Dipanggil LaunchAgent tiap 01:30 (infra/launchd/com.wrg.backup-harian.plist).
# Manual:  bash scripts/ops/backup-harian.sh [--uji-pulih] [--tanpa-unggah]
# Kunci (sekali, simpan JUGA di password manager — tanpa kunci cadangan tak bisa dibuka):
#   mkdir -p ~/.wrg-os/secrets && openssl rand -base64 48 > ~/.wrg-os/secrets/backup-key && chmod 600 ~/.wrg-os/secrets/backup-key
# Membuka cadangan:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:$HOME/.wrg-os/secrets/backup-key -in X.dump.enc -out X.dump
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DB="${BACKUP_DB:-wrg_os_prod}"
DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
OPS="$HOME/DevWRG/ops"
LOKAL="$OPS/backup-harian"
LOG="$OPS/backup-harian.log"
KUNCI="${BACKUP_KEY_FILE:-$HOME/.wrg-os/secrets/backup-key}"
UJI_DB="wrg_os_uji_pulih"
SIMPAN_LOKAL_HARI=7
SIMPAN_DRIVE_HARI=30
TABEL_KUNCI="accurate_invoice app_user crm_account deal wa_message"

UJI=""; UNGGAH=1
for a in "$@"; do
  case "$a" in
    --uji-pulih) UJI=1 ;;
    --tanpa-unggah) UNGGAH="" ;;
  esac
done
[ "$(date +%u)" = "7" ] && UJI=1   # Minggu: uji pulih otomatis

mkdir -p "$LOKAL"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }
prod_env() { grep -E "^$1=" "$DIR/.env.prod" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

wa_send() {
  local to url sec
  to="$(prod_env DISK_ALERT_TO)"; [ -z "$to" ] && to="$(prod_env WRG_DEPLOY_ALERT_TO)"
  url="$(prod_env WA_SEND_URL)"; sec="$(prod_env WA_SEND_SECRET)"
  [ -n "$url" ] && [ -n "$to" ] || { log "WA dilewati — tujuan/URL kosong"; return 1; }
  WA_URL="$url" WA_SEC="$sec" WA_TO="$to" WA_MSG="$1" python3 - >>"$LOG" 2>&1 <<'PY'
import os, json, sys, urllib.request
h = {"content-type": "application/json"}
if os.environ.get("WA_SEC"): h["x-wa-secret"] = os.environ["WA_SEC"]
req = urllib.request.Request(os.environ["WA_URL"], headers=h,
    data=json.dumps({"to": os.environ["WA_TO"], "message": os.environ["WA_MSG"]}).encode())
try:
    with urllib.request.urlopen(req, timeout=15) as r: print(f"WA HTTP {r.status}")
except Exception as e:
    print(f"WA gagal: {e}"); sys.exit(1)
PY
}

gagal() {
  log "GAGAL: $1"
  wa_send "🔴 *Cadangan database GAGAL* — $(date '+%d/%m %H:%M')
$1
Database produksi belum tercadang malam ini. Log: ~/DevWRG/ops/backup-harian.log"
  exit 1
}

STEMPEL="$(date +%Y%m%d-%H%M)"
DUMP="$LOKAL/${DB}-${STEMPEL}.dump"
ENC="$DUMP.enc"

[ -s "$KUNCI" ] || gagal "kunci enkripsi tak ada di $KUNCI (lihat kepala skrip untuk membuatnya)"

# ── 1. Dump ──
log "mulai dump $DB"
pg_dump -d "$DB" -Fc -Z 6 -f "$DUMP" 2>>"$LOG" || gagal "pg_dump gagal"
N_ISI=$(pg_restore -l "$DUMP" 2>>"$LOG" | grep -c " TABLE DATA ") || true
[ "${N_ISI:-0}" -gt 0 ] || gagal "dump tak terbaca pg_restore -l"
log "dump OK: $(du -h "$DUMP" | cut -f1), $N_ISI tabel berdata"

# ── 2. Enkripsi + unggah ──
if [ -n "$UNGGAH" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KUNCI" -in "$DUMP" -out "$ENC" 2>>"$LOG" || gagal "enkripsi gagal"
  # buka lagi & bandingkan checksum: memastikan berkas yang diunggah memang bisa didekripsi
  A=$(shasum -a 256 < "$DUMP" | cut -d' ' -f1)
  B=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KUNCI" -in "$ENC" 2>>"$LOG" | shasum -a 256 | cut -d' ' -f1)
  [ "$A" = "$B" ] || gagal "uji dekripsi tak cocok"
  export GDRIVE_OAUTH_FILE="${GDRIVE_OAUTH_FILE:-$(prod_env GDRIVE_OAUTH_FILE)}"
  export GDRIVE_BACKUP_FOLDER_ID="${GDRIVE_BACKUP_FOLDER_ID:-$(prod_env GDRIVE_BACKUP_FOLDER_ID)}"
  H=$(node "$DIR/scripts/ops/gdrive-unggah.mjs" unggah "$ENC" 2>>"$LOG") || gagal "unggah ke Drive gagal: $H"
  log "unggah OK: $H"
  rm -f "$ENC"
  R=$(node "$DIR/scripts/ops/gdrive-unggah.mjs" retensi --awalan "${DB}-" --hari "$SIMPAN_DRIVE_HARI" 2>>"$LOG") || log "retensi Drive gagal (tak menggagalkan cadangan): $R"
  log "retensi Drive: $R"
else
  log "unggah dilewati (--tanpa-unggah)"
fi

# ── 3. Retensi lokal ──
find "$LOKAL" -name "${DB}-*.dump" -mtime +"$SIMPAN_LOKAL_HARI" -print -delete >>"$LOG" 2>&1

# ── 4. Uji pulih (Minggu / --uji-pulih) ──
if [ -n "$UJI" ]; then
  log "uji pulih ke $UJI_DB"
  dropdb --if-exists "$UJI_DB" 2>>"$LOG"
  createdb "$UJI_DB" 2>>"$LOG" || gagal "uji pulih: createdb gagal"
  # --no-owner/--no-acl: DB uji tak butuh role & hak prod; galat kecil (mis. user mapping FDW) dicatat, bukan penentu.
  pg_restore -d "$UJI_DB" --no-owner --no-acl -j 2 "$DUMP" >>"$LOG" 2>&1 || log "pg_restore selesai dengan peringatan (lihat log)"
  hitung() { psql -d "$1" -XAtq -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'"; }
  TP=$(hitung "$DB"); TU=$(hitung "$UJI_DB")
  BEDA=""
  for t in $TABEL_KUNCI; do
    p=$(psql -d "$DB" -XAtq -c "select count(*) from $t" 2>/dev/null || echo 0)
    u=$(psql -d "$UJI_DB" -XAtq -c "select count(*) from $t" 2>/dev/null || echo -1)
    # prod boleh bertambah sedikit sejak dump (pesan WA masuk); hasil pulih tak boleh di bawah 99%
    if [ "$u" -lt 0 ] || [ $((u * 100)) -lt $((p * 99)) ]; then BEDA="$BEDA $t($u/$p)"; fi
  done
  dropdb --if-exists "$UJI_DB" 2>>"$LOG"
  [ "$TP" = "$TU" ] || gagal "uji pulih: jumlah tabel $TU ≠ prod $TP"
  [ -z "$BEDA" ] || gagal "uji pulih: baris kurang di$BEDA"
  log "uji pulih OK: $TU tabel, tabel kunci lengkap ($TABEL_KUNCI)"
fi

log "SELESAI"
exit 0
