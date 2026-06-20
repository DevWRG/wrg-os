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

# === SANITY CHECKS ===
command -v gh >/dev/null || { log "ERROR: gh CLI not installed"; exit 1; }
command -v pm2 >/dev/null || { log "ERROR: pm2 not installed"; exit 1; }
command -v jq >/dev/null || { log "ERROR: jq not installed (brew install jq)"; exit 1; }

# Ensure on main branch + fresh
git fetch origin main --quiet
git checkout main --quiet
git pull origin main --quiet

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
    "totalFeatures": 149,
    "range": "F1-F117",
    "comment": "Catalog detail di-maintain manual via Cowork (Sprint Dashboard FEATURES array)"
  },
  "_meta": {
    "source": "Auto-generated dari pm2 jlist + gh CLI + .env.prod",
    "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "host": "$(hostname)"
  }
}
JSON

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

# Optional: auto-merge ke dev kalau bypass CI gate (state file only)
# gh pr merge --auto --squash

log "=== sync-state.sh END ==="
