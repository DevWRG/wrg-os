#!/bin/bash
# sync-state.sh — Auto-update state/*.json dari live data (pm2, gh CLI)
# Path: ~/DevWRG/wrg-os/scripts/ops/sync-state.sh
#
# Triggers:
# - Cron daily 07:00 WIB (auto)
# - Manual: wrg-sync alias atau langsung run
# - GitHub Actions on-release (Fase 3 future)
#
# Author: Husni Mubarrak · 2026-06-20

set -e  # exit on error
set -u  # exit on unset var

# === CONFIG ===
REPO_DIR="$HOME/DevWRG/wrg-os"
STATE_DIR="$REPO_DIR/state"
LOG_DIR="$HOME/DevWRG/ops"
LOG_FILE="$LOG_DIR/sync-state.log"
BRANCH="state-sync-$(date +%Y%m%d-%H%M)"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=== sync-state.sh START ==="

cd "$REPO_DIR" || { log "ERROR: $REPO_DIR not found"; exit 1; }

# SELALU balik ke main saat keluar (sukses/gagal/abort set -e). Tanpa ini, kalau
# push/PR gagal (mis. cron tanpa kredensial git) repo nyangkut di branch
# state-sync-* → auto-deploy poller skip ("branch bukan main") → deploy MATI.
# -f buang perubahan state/*.json uncommitted (di-regen tiap run); untracked aman.
trap 'git checkout -f main --quiet 2>/dev/null || true' EXIT

# === SANITY CHECKS ===
command -v gh >/dev/null || { log "ERROR: gh CLI not installed"; exit 1; }
command -v pm2 >/dev/null || { log "ERROR: pm2 not installed"; exit 1; }
command -v jq >/dev/null || { log "ERROR: jq not installed (brew install jq)"; exit 1; }

# Base dari DEV (bukan main): state PR target dev, jadi branch-nya HARUS based-on
# dev biar merge bersih. Dulu based-on main → tiap state lama yg udah merge ke dev
# bikin PR berikutnya konflik (state files). Reset --hard origin/dev (server tak
# punya commit lokal di dev; state di-regen fresh jadi aman). Trap EXIT tetap balik
# ke main utk auto-deploy.
git fetch origin dev --quiet
git checkout dev --quiet 2>/dev/null || git checkout -b dev --quiet origin/dev
git reset --hard origin/dev --quiet

mkdir -p "$STATE_DIR"

# === GENERATE dashboard-state.json ===
log "Generating dashboard-state.json..."

LATEST_VERSION=$(gh release view --json tagName -q .tagName 2>/dev/null || echo "unknown")
LATEST_DATE=$(gh release view --json publishedAt -q .publishedAt 2>/dev/null || echo "")
TOTAL_RELEASES=$(gh release list --limit 1000 --json tagName -q '. | length' 2>/dev/null || echo 0)

# Count services LIVE dari pm2
SERVICES_JSON=$(pm2 jlist 2>/dev/null | jq -c '
  [.[] | select(.name | startswith("wrg-prod-")) |
   {name: .name,
    port: (.pm2_env.PORT // null),
    status: (if .pm2_env.status == "online" then "LIVE" else "DOWN" end),
    uptime_sec: (.pm2_env.pm_uptime // 0 | (now * 1000 - .) / 1000 | floor)
   }]')
SERVICES_LIVE=$(echo "$SERVICES_JSON" | jq '[.[] | select(.status == "LIVE")] | length')

# Count scheduler ENABLED dari .env.prod
ENV_FILE="$REPO_DIR/.env.prod"
SCHEDULER_JOBS=0
if [ -f "$ENV_FILE" ]; then
  SCHEDULER_JOBS=$(grep -cE '^[A-Z_]+_ENABLED=true' "$ENV_FILE" 2>/dev/null || echo 0)
fi

# Generate JSON
cat > "$STATE_DIR/dashboard-state.json" <<JSON
{
  "schemaVersion": "1.0.0",
  "lastUpdate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "generatedBy": "sync-state.sh (Warp cron/manual)",
  "production": {
    "version": "$LATEST_VERSION",
    "releasedAt": "$LATEST_DATE",
    "totalReleases": $TOTAL_RELEASES,
    "goLiveDate": "2026-06-15"
  },
  "infrastructure": {
    "stack": "Next.js 16 + Hono + FastAPI (3-tier)",
    "deployment": "Native pm2 Mac (BUKAN Docker)",
    "services": $SERVICES_JSON,
    "servicesLive": $SERVICES_LIVE,
    "schedulerJobs": $SCHEDULER_JOBS,
    "cutoverMarkers": 22,
    "cutoverStatus": "TUNTAS"
  },
  "access": {
    "internal": "https://mac-mini-development.tail88405f.ts.net/",
    "public": "https://os.wahanalifeline.co.id",
    "publicSince": "2026-06-17",
    "githubRepo": "https://github.com/DevWRG/wrg-os"
  },
  "catalog": {
    "totalFeatures": 185,
    "range": "F1-F147",
    "built": 55,
    "builtDev": 43,
    "comment": "Angka disalin manual dari array FEATURES di WRG-OS-Sprint-Dashboard.html (SoT katalog, di Drive). Terakhir dicocokkan 2026-08-29: 185 entri, 53 BUILT + 2 PROD-LIVE-WRGCRM = 55 di main, 43 BUILT-DEV menunggu promosi. Perbarui di SINI kalau blueprint berubah — file state ditulis ulang tiap run, jadi edit manual di dashboard-state.json pasti hilang."
  },
  "_meta": {
    "source": "Auto-generated dari pm2 jlist + gh CLI + .env.prod",
    "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "host": "$(hostname)"
  }
}
JSON

# === MERGE tooling.* dari warp-tooling.json (idempotent) ===
# dashboard-state.json ditulis ULANG dari heredoc di atas tiap run, dan script ini
# diawali `git reset --hard origin/dev` — jadi apa pun yang ditambah manual ke file
# ini pasti hilang tiap 07:00 WIB. Sumber kebenaran tooling = state/warp-tooling.json
# (di-maintain via Cowork/Drive, di-push lewat 14-Plugins/wrg-os-toolkit/scripts/
# push-to-github.sh). Di-merge balik ke sini biar widget Live Status cukup baca 1 file.
# No-op kalau warp-tooling.json belum ada.
if [ -f "$STATE_DIR/warp-tooling.json" ]; then
  TMP_DS="$(mktemp)"
  if jq --slurpfile t "$STATE_DIR/warp-tooling.json" '
        . + {tooling: {
              sourceFile: "state/warp-tooling.json",
              lastUpdate: ($t[0].lastUpdate // null),
              claudePlugins: ($t[0].claudeCodePlugins // []),
              mcpServers: ($t[0].mcpServers // {})
            }}' "$STATE_DIR/dashboard-state.json" > "$TMP_DS" 2>/dev/null; then
    mv "$TMP_DS" "$STATE_DIR/dashboard-state.json"
    TOOLING_N=$(jq '.tooling.claudePlugins | length' "$STATE_DIR/dashboard-state.json")
    log "✓ tooling.* di-merge dari warp-tooling.json ($TOOLING_N plugin)"
  else
    rm -f "$TMP_DS"
    log "⚠ merge tooling GAGAL (warp-tooling.json invalid?) — dashboard-state.json dibiarkan apa adanya"
  fi
else
  log "· warp-tooling.json belum ada — skip merge tooling"
fi

log "✓ dashboard-state.json: version=$LATEST_VERSION, releases=$TOTAL_RELEASES, services=$SERVICES_LIVE LIVE, scheduler=$SCHEDULER_JOBS"

# === GENERATE release-log.json (20 latest) ===
log "Generating release-log.json..."

RELEASES_JSON=$(gh release list --limit 20 --json tagName,publishedAt,name 2>/dev/null | jq -c '
  [.[] | {
    tag: .tagName,
    date: (.publishedAt | split("T")[0]),
    summary: .name
  }]')

cat > "$STATE_DIR/release-log.json" <<JSON
{
  "schemaVersion": "1.0.0",
  "lastUpdate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "totalReleases": $TOTAL_RELEASES,
  "latest": "$LATEST_VERSION",
  "releases": $RELEASES_JSON,
  "_meta": {
    "fullList": "https://github.com/DevWRG/wrg-os/releases",
    "openPRs": "https://github.com/DevWRG/wrg-os/pulls?state=open"
  }
}
JSON

log "✓ release-log.json: 20 latest releases"

# === current-sprint.json TIDAK auto-update (manual via Cowork prompt per Senin) ===
# Skip — leave as is. Husni atau Cowork agent update tiap Senin.
log "ℹ current-sprint.json SKIPPED (manual update tiap Senin via Cowork)"

# === GIT COMMIT + PUSH ke branch state-sync ===
cd "$REPO_DIR"

# Check kalau ada perubahan
if git diff --quiet state/ ; then
  log "ℹ No changes detected — skip commit."
  log "=== sync-state.sh END (no-op) ==="
  exit 0
fi

log "Changes detected — commit + push ke branch $BRANCH..."

git checkout -b "$BRANCH" --quiet
git add state/
git commit -m "chore(state): auto-sync dashboard state ($(date '+%Y-%m-%d %H:%M'))

Auto-generated dari sync-state.sh:
- production.version: $LATEST_VERSION
- totalReleases: $TOTAL_RELEASES
- servicesLive: $SERVICES_LIVE/5
- schedulerJobs: $SCHEDULER_JOBS

Trigger: ${SYNC_TRIGGER:-manual/cron}" --quiet

git push origin "$BRANCH" --quiet

# Buka PR auto-merge ke dev (main merge gate Husni — jangan auto promote ke main!)
PR_URL=$(gh pr create \
  --base dev \
  --head "$BRANCH" \
  --title "chore(state): auto-sync $(date '+%Y-%m-%d %H:%M')" \
  --body "Automated state sync. Version $LATEST_VERSION · $TOTAL_RELEASES releases · $SERVICES_LIVE/5 services LIVE · $SCHEDULER_JOBS scheduler jobs.

**Auto-merge to dev OK** (state file only, no code).
**Manual gate to main:** Husni promote dev→main sesuai aturan." 2>&1 | tail -1)

log "✓ PR created: $PR_URL"

# Auto-merge langsung ke dev (state file only, no code → aman skip CI; dev tak
# protected). Cegah PR state numpuk yg bikin konflik antar-hari (PR belakangan
# nabrak PR sebelumnya yg merge telat). Squash + hapus branch.
PR_NUM="$(printf '%s' "$PR_URL" | grep -oE '[0-9]+$')"
if [ -n "$PR_NUM" ]; then
  if gh pr merge "$PR_NUM" --squash --delete-branch >/dev/null 2>&1; then
    log "✓ auto-merged PR #$PR_NUM ke dev"
  else
    log "⚠️ auto-merge PR #$PR_NUM gagal — merge manual (mungkin konflik/CI)"
  fi
fi

log "=== sync-state.sh END ==="
