#!/usr/bin/env bash
# auto-deploy.sh — poller auto-deploy untuk Mac mini (dipanggil periodik oleh
# launchd: infra/launchd/com.wrg.autodeploy.plist). Tanpa GitHub runner / tanpa
# scope token: cukup script ini + 1 launchd job di server.
#
# Logika: fetch origin/main → kalau maju dari HEAD lokal → deploy-prod.sh --yes.
# Idempoten, lockdir anti-tumpang-tindih, semua ter-log. Promote dev→main →
# dalam <interval> menit server otomatis ke versi baru.
#
# HANYA menyentuh wrg-prod-api/web (via deploy-prod.sh). Python legacy (8090–8092)
# & wa-bridge TIDAK pernah disentuh.
#
# Env opsional: WRG_PROD_DIR (default ~/DevWRG/wrg-os), WRG_DEPLOY_LOG.
set -euo pipefail

DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
LOG="${WRG_DEPLOY_LOG:-$HOME/DevWRG/ops/auto-deploy.log}"
LOCKDIR="/tmp/wrg-auto-deploy.lockd"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

mkdir -p "$(dirname "$LOG")"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }

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

log "main maju ${LOCAL:0:7} → ${REMOTE:0:7} — mulai deploy"
if bash scripts/ops/deploy-prod.sh --yes >>"$LOG" 2>&1; then
  log "deploy OK → $(git rev-parse --short HEAD)"
else
  log "deploy GAGAL (cek log di atas) — akan dicoba lagi tiap interval"
fi
