#!/usr/bin/env bash
# revive-remote-access.sh — SEMENTARA. HAPUS SETELAH AKSES REMOTE PULIH.
#
# Konteks (2026-08-09): semua jalur remote ke Mac mini prod mati bersamaan —
# TeamViewer "Offline", dan laptop nyasar ke tailnet lain (tail56e370 hasil login
# Google Workspace, sedangkan mini di tail88405f) — sementara tak ada orang di
# lokasi mini. Satu-satunya kanal eksekusi yang tersisa = pipeline auto-deploy
# itu sendiri: LaunchAgent com.wrg.autodeploy poll origin/main tiap 120 dtk →
# auto-deploy.sh → deploy-prod.sh, dan deploy-prod.sh re-exec dirinya SETELAH
# `git pull` (deploy-prod.sh:64) sehingga kode yang baru di-merge ikut jalan di
# siklus yang sama.
#
# Tugas:
#   1. Bangunin TeamViewer di mini (open -a, lalu kickstart agent GUI-nya).
#   2. Coba nyalakan Remote Login (SSH bawaan macOS) — jalur kedua yang
#      independen dari TeamViewer. Pakai `sudo -n`: kalau sudoers tak kasih
#      NOPASSWD, gagal bersih tanpa pernah minta password.
#   3. Kirim diagnostik akses remote via WA ke WRG_DEPLOY_ALERT_TO, supaya
#      "mini di tailnet mana, Remote Login ON/OFF, pm2 sehat?" terjawab tanpa
#      perlu masuk ke mini.
#
# ATURAN KERAS:
#   - TIDAK boleh menggagalkan deploy. deploy-prod.sh pakai `set -euo pipefail`;
#     satu exit non-zero yang bocor = prod tidak ke-deploy. Karena itu script ini
#     sengaja TANPA `-e`, tiap langkah di-`|| true`, dan selalu `exit 0`.
#   - TIDAK ada secret hardcoded — repo ini PUBLIC. WA_SEND_URL/WA_SEND_SECRET/
#     WRG_DEPLOY_ALERT_TO dibaca dari .env.prod saat runtime (pola wa_alert()
#     di auto-deploy.sh:61). Isi .env.prod tidak pernah di-log/dikirim.
#   - Idempoten & tidak spam: WA cuma dikirim kalau ringkasan diagnostik BERUBAH
#     dari deploy sebelumnya (edge-trigger, pola sama dgn .pending-migrations.state).
#   - Cuma jalan di macOS. Di CI/laptop langsung keluar tanpa efek.
set -uo pipefail   # sengaja TANPA -e

[ "$(uname -s 2>/dev/null)" = "Darwin" ] || exit 0

ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
LOG="$HOME/DevWRG/ops/revive-remote-access.log"
STATE="$HOME/DevWRG/ops/.revive-remote-access.state"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Tailscale.app/Contents/MacOS:$HOME/.local/bin:$PATH"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG" 2>/dev/null || true; }

# Baca 1 key dari .env.prod tanpa membocorkannya ke log. Kosong kalau tak ada.
prod_env() { grep -E "^$1=" "$ROOT/.env.prod" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

log "=== revive-remote-access MULAI (host $(hostname -s 2>/dev/null), user $(id -un 2>/dev/null)) ==="

# ── 1) TeamViewer ─────────────────────────────────────────────────
# teamviewerd itu LaunchDaemon (root) — sengaja TIDAK disentuh supaya tak ada
# prompt password di konteks launchd. Agent GUI + `open -a` sudah cukup untuk
# bikin device muncul online di device list.
TV_BEFORE="mati"; pgrep -x TeamViewer >/dev/null 2>&1 && TV_BEFORE="jalan"
open -a TeamViewer >>"$LOG" 2>&1 || log "  open -a TeamViewer gagal (app tak terdaftar di LaunchServices?)"
launchctl kickstart -k "gui/$(id -u)/com.teamviewer.teamviewer" >>"$LOG" 2>&1 \
  || log "  kickstart agent TeamViewer dilewati (label tak terdaftar — normal kalau open -a sudah cukup)"
sleep 5
TV_AFTER="mati"; pgrep -x TeamViewer >/dev/null 2>&1 && TV_AFTER="jalan"
log "  TeamViewer: $TV_BEFORE → $TV_AFTER"

# ── 2) Remote Login (SSH bawaan macOS) ────────────────────────────
# `systemsetup -getremotelogin` butuh root di macOS baru → coba sudo -n dulu,
# lalu tanpa sudo. sudo -n = non-interaktif, tak akan pernah menggantung deploy.
RL="$(sudo -n systemsetup -getremotelogin 2>/dev/null || systemsetup -getremotelogin 2>/dev/null)"
RL="$(printf '%s' "${RL:-}" | tr -d '\n')"
case "${RL:-unknown}" in
  *Off*|*off*)
    if sudo -n systemsetup -setremotelogin on >>"$LOG" 2>&1; then
      RL="Remote Login: On (baru diaktifkan deploy ini)"
      log "  Remote Login: OFF → ON"
    else
      RL="Remote Login: Off (sudo -n ditolak — perlu aktifkan manual)"
      log "  Remote Login masih OFF — sudo -n ditolak (tak ada NOPASSWD di sudoers)"
    fi
    ;;
  *) log "  ${RL:-Remote Login: status tak terbaca}" ;;
esac

# ── 3) Kumpulkan diagnostik ───────────────────────────────────────
TS_STATUS="$(tailscale status 2>&1 | head -3)"
TS_SELF="$(tailscale status --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);console.log((d.Self&&d.Self.DNSName||"?")+" | tailnet="+(d.MagicDNSSuffix||"?")+" | peers="+Object.keys(d.Peer||{}).length)}catch(e){console.log("(tailscale json tak terbaca)")}})' 2>/dev/null)"
TS_PROFILES="$(tailscale switch --list 2>&1 | tail -n +2 | head -5)"
PM2_SUM="$(pm2 jlist 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).map(p=>p.name+":"+p.pm2_env.status).join(", "))}catch(e){console.log("(pm2 tak terbaca)")}})' 2>/dev/null)"
GIT_HEAD="$(git -C "$ROOT" describe --tags --always 2>/dev/null) ($(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null))"
UP="$(uptime 2>/dev/null | sed -E 's/.*up ([^,]+,?[^,]*),.*users.*/\1/' | head -1)"

SUMMARY="$(cat <<EOF
🔧 WRG-OS PROD — diagnostik akses remote (dari hook deploy)

Host      : $(hostname -s 2>/dev/null) / user $(id -un 2>/dev/null)
Uptime    : ${UP:-?}
Versi     : ${GIT_HEAD:-?}
pm2       : ${PM2_SUM:-(kosong)}

TeamViewer: $TV_BEFORE → $TV_AFTER
SSH       : ${RL:-tak terbaca}

Tailscale : ${TS_SELF:-(tak terbaca)}
${TS_STATUS:-(status kosong)}
Profil    :
${TS_PROFILES:-(tak ada)}
EOF
)"

log "--- ringkasan ---"
printf '%s\n' "$SUMMARY" >>"$LOG" 2>/dev/null || true

# ── 4) Kirim via WA (edge-trigger: hanya kalau ringkasan berubah) ──
CUR="$(printf '%s' "$SUMMARY" | shasum -a 256 2>/dev/null | cut -d' ' -f1)"
PREV=""; [ -f "$STATE" ] && PREV="$(cat "$STATE" 2>/dev/null)"
if [ -n "$CUR" ] && [ "$CUR" = "$PREV" ]; then
  log "  (ringkasan sama spt deploy lalu → WA tidak diulang)"
  exit 0
fi

TO="$(prod_env WRG_DEPLOY_ALERT_TO)"
URL="$(prod_env WA_SEND_URL)"
SEC="$(prod_env WA_SEND_SECRET)"
if [ -z "$URL" ] || [ -z "$TO" ]; then
  log "  (WA dilewati — WA_SEND_URL / WRG_DEPLOY_ALERT_TO belum di-set di .env.prod)"
  exit 0
fi

MSG="$(printf '%s' "$SUMMARY" | head -c 1500)"
if WA_URL="$URL" WA_SEC="$SEC" WA_TO="$TO" WA_MSG="$MSG" python3 - >>"$LOG" 2>&1 <<'PY'
import os, json, urllib.request
url, sec = os.environ["WA_URL"], os.environ.get("WA_SEC", "")
to, msg = os.environ["WA_TO"], os.environ["WA_MSG"]
h = {"content-type": "application/json"}
if sec:
    h["x-wa-secret"] = sec
req = urllib.request.Request(url, data=json.dumps({"to": to, "message": msg}).encode(), headers=h)
r = urllib.request.urlopen(req, timeout=15)
print(f"   diagnostik WA terkirim (HTTP {r.status})")
PY
then
  mkdir -p "$(dirname "$STATE")" 2>/dev/null || true
  printf '%s' "$CUR" >"$STATE" 2>/dev/null || true
  log "  diagnostik terkirim ke WA"
else
  log "  (kirim WA gagal — cek gateway; state tidak disimpan biar dicoba lagi deploy berikutnya)"
fi

log "=== revive-remote-access SELESAI ==="
exit 0
