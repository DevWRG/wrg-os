#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gateway-watchdog.sh — pantau openclaw WhatsApp gateway, auto-restart + alert.
#
# Latar: 2026-06-19 gateway openclaw mati diam-diam ~17:00–19:00 WIB → nol pesan
# ter-capture → #Report sales (Sari/Rahma dll) hilang tanpa jejak. Watchdog ini
# mendeteksi kondisi itu lebih awal dan memulihkan otomatis.
#
# Deteksi "tidak sehat" (salah satu):
#   - `openclaw channels status --json` gagal/timeout  → proses gateway wedged
#   - channels.whatsapp.connected/running/linked == false
#   - (jam aktif 07–22 WIB) lastInboundAt sudah > STALE_RESTART_MIN menit
#     → gateway "connected" tapi diam tak menerima (kasus 19 Jun)
#
# Aksi (mode: auto-restart + alert):
#   - butuh FAIL_THRESHOLD cek "tidak sehat" berturut (debounce blip sesaat)
#   - restart: launchctl kickstart -k gui/<uid>/ai.openclaw.gateway
#     (cooldown RESTART_COOLDOWN_SEC → anti restart-loop)
#   - alert WA ke owner via bridge /send (cooldown ALERT_COOLDOWN_SEC → anti-spam)
#
# Dipanggil cron tiap 2 menit. Stateless antar-run kecuali file state JSON.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# ── Konfigurasi ──
LAUNCHD_LABEL="ai.openclaw.gateway"
BRIDGE_SEND_URL="http://127.0.0.1:18080/send"
ENV_PROD="/Users/development/DevWRG/wrg-os/.env.prod"   # sumber WA_SEND_SECRET
ALERT_TARGET="+6285733048855"                            # owner (DM)
DASHBOARD_HINT="os.wahanalifeline.co.id"

FAIL_THRESHOLD=2            # cek tidak-sehat berturut sebelum bertindak (~4 mnt @cron 2mnt)
RESTART_COOLDOWN_SEC=600    # jeda min antar auto-restart (10 mnt)
ALERT_COOLDOWN_SEC=1800     # jeda min antar WA alert (30 mnt)
STALE_WARN_MIN=45           # jam aktif: warning kalau inbound diam selama ini
STALE_RESTART_MIN=75        # jam aktif: anggap tidak-sehat (restart) bila inbound diam selama ini
ACTIVE_START_WIB=7          # jam aktif (WIB) untuk cek staleness
ACTIVE_END_WIB=22
STATUS_TIMEOUT_SEC=15

DIR="/Users/development/DevWRG/ops"
STATE="$DIR/.gateway-watchdog-state.json"
LOG="$DIR/gateway-watchdog.log"

now_epoch() { date +%s; }
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >> "$LOG"; }

# macOS tak punya `timeout`/`gtimeout` → pakai perl alarm sbg pengganti.
TO() { perl -e 'alarm shift; exec @ARGV' "$@"; }

# ── State helpers (JSON via python3) ──
read_state() { # $1 = key, $2 = default
  python3 - "$STATE" "$1" "$2" <<'PY' 2>/dev/null || echo "$3"
import sys,json,os
f,k,d=sys.argv[1],sys.argv[2],sys.argv[3]
try:
    s=json.load(open(f))
    print(s.get(k,d))
except Exception:
    print(d)
PY
  return 0
}
write_state() { # key=value pairs as args
  python3 - "$STATE" "$@" <<'PY' 2>/dev/null
import sys,json
f=sys.argv[1]; kv=sys.argv[2:]
try: s=json.load(open(f))
except Exception: s={}
for pair in kv:
    k,_,v=pair.partition("=")
    s[k]=v
json.dump(s,open(f,"w"))
PY
}

send_alert() { # $1 = message
  local msg="$1" secret
  secret=$(grep -E '^WA_SEND_SECRET=' "$ENV_PROD" 2>/dev/null | cut -d= -f2- | tr -d '"')
  MSG="$msg" TARGET="$ALERT_TARGET" SECRET="$secret" URL="$BRIDGE_SEND_URL" python3 - <<'PY'
import os,json,urllib.request
payload=json.dumps({"to":os.environ["TARGET"],"message":os.environ["MSG"]}).encode()
req=urllib.request.Request(os.environ["URL"],data=payload,
    headers={"content-type":"application/json","x-wa-secret":os.environ["SECRET"]},method="POST")
try:
    with urllib.request.urlopen(req,timeout=30) as r: print("alert-http",r.status)
except Exception as e: print("alert-err",e)
PY
}

restart_gateway() {
  launchctl kickstart -k "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1
  return $?
}

# ── 1. Ambil status gateway ──
STATUS_JSON="$(TO "$STATUS_TIMEOUT_SEC" openclaw channels status --channel whatsapp --json 2>/dev/null)"
STATUS_RC=$?

HEALTHY=0; REASON=""; INBOUND_AGE_MIN=-1
if [ $STATUS_RC -ne 0 ] || [ -z "$STATUS_JSON" ]; then
  REASON="status-cmd-fail(rc=$STATUS_RC) — gateway wedged/unreachable"
else
  eval "$(SJ="$STATUS_JSON" python3 <<'PY' 2>/dev/null
import os,json,time
try: d=json.loads(os.environ["SJ"])
except Exception:
    print('PARSE_OK=0'); raise SystemExit
ch=(d.get("channels") or {}).get("whatsapp") or {}
conn=bool(ch.get("connected")); run=bool(ch.get("running")); link=bool(ch.get("linked"))
last=ch.get("lastInboundAt") or 0
age=int((time.time()*1000 - last)/60000) if last else -1
print(f'PARSE_OK=1')
print(f'CONN={1 if conn else 0}')
print(f'RUN={1 if run else 0}')
print(f'LINK={1 if link else 0}')
print(f'AGE={age}')
PY
)"
  if [ "${PARSE_OK:-0}" != "1" ]; then
    REASON="status-json-parse-fail"
  elif [ "${CONN:-0}" != "1" ] || [ "${RUN:-0}" != "1" ] || [ "${LINK:-0}" != "1" ]; then
    REASON="not-connected (connected=${CONN:-?} running=${RUN:-?} linked=${LINK:-?})"
  else
    HEALTHY=1; INBOUND_AGE_MIN="${AGE:--1}"
  fi
fi

# ── 2. Cek staleness (jam aktif) — gateway "connected" tapi diam ──
WIB_HOUR=$(TZ='Asia/Jakarta' date +%H); WIB_HOUR=$((10#$WIB_HOUR))
ACTIVE=0; [ "$WIB_HOUR" -ge "$ACTIVE_START_WIB" ] && [ "$WIB_HOUR" -lt "$ACTIVE_END_WIB" ] && ACTIVE=1
STALE_WARN=0
if [ "$HEALTHY" = "1" ] && [ "$ACTIVE" = "1" ] && [ "$INBOUND_AGE_MIN" -ge 0 ]; then
  if [ "$INBOUND_AGE_MIN" -ge "$STALE_RESTART_MIN" ]; then
    HEALTHY=0; REASON="stale-inbound ${INBOUND_AGE_MIN}m (jam aktif, ≥${STALE_RESTART_MIN}m)"
  elif [ "$INBOUND_AGE_MIN" -ge "$STALE_WARN_MIN" ]; then
    STALE_WARN=1
  fi
fi

# ── 3. State & keputusan ──
NOW=$(now_epoch)
CONSEC=$(read_state consec_fail 0); CONSEC=$((10#${CONSEC:-0}))
LAST_RESTART=$(read_state last_restart_ts 0); LAST_RESTART=$((10#${LAST_RESTART:-0}))
LAST_ALERT=$(read_state last_alert_ts 0);   LAST_ALERT=$((10#${LAST_ALERT:-0}))
PREV=$(read_state last_state up)

if [ "$HEALTHY" = "1" ]; then
  if [ "$CONSEC" -gt 0 ] || [ "$PREV" = "down" ]; then
    log "RECOVERED — gateway sehat lagi (inbound_age=${INBOUND_AGE_MIN}m). reset counter."
    [ "$((NOW - LAST_ALERT))" -ge "$ALERT_COOLDOWN_SEC" ] && {
      send_alert "✅ Gateway WhatsApp pulih (auto). Inbound terakhir ${INBOUND_AGE_MIN} mnt lalu. Dashboard: $DASHBOARD_HINT"
      write_state "last_alert_ts=$NOW"
    }
  fi
  [ "$STALE_WARN" = "1" ] && log "WARN — connected tapi inbound diam ${INBOUND_AGE_MIN}m (jam aktif)."
  write_state "consec_fail=0" "last_state=up" "last_check_ts=$NOW"
  exit 0
fi

# tidak sehat
CONSEC=$((CONSEC + 1))
write_state "consec_fail=$CONSEC" "last_state=down" "last_check_ts=$NOW"
log "UNHEALTHY ($CONSEC/$FAIL_THRESHOLD) — $REASON"

if [ "$CONSEC" -lt "$FAIL_THRESHOLD" ]; then
  exit 0   # masih debounce
fi

# ── 4. Bertindak: restart (cooldown) + alert (cooldown) ──
DID_RESTART="(skip: cooldown)"
if [ "$((NOW - LAST_RESTART))" -ge "$RESTART_COOLDOWN_SEC" ]; then
  if restart_gateway; then DID_RESTART="restart OK"; else DID_RESTART="restart GAGAL(rc=$?)"; fi
  write_state "last_restart_ts=$NOW"
  log "ACTION restart → $DID_RESTART"
  sleep 20
  POST="$(TO "$STATUS_TIMEOUT_SEC" openclaw channels status --channel whatsapp --json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);c=(d.get("channels") or {}).get("whatsapp") or {};print("connected" if c.get("connected") else "belum-connected")' 2>/dev/null)"
  log "post-restart status: ${POST:-tak-terbaca}"
else
  log "ACTION restart di-skip (cooldown ${RESTART_COOLDOWN_SEC}s belum lewat)"
fi

if [ "$((NOW - LAST_ALERT))" -ge "$ALERT_COOLDOWN_SEC" ]; then
  send_alert "⚠️ Gateway WhatsApp BERMASALAH — $REASON. Watchdog: $DID_RESTART. Cek capture & openclaw. Dashboard: $DASHBOARD_HINT"
  write_state "last_alert_ts=$NOW"
  log "ALERT terkirim ke $ALERT_TARGET"
else
  log "ALERT di-skip (cooldown ${ALERT_COOLDOWN_SEC}s belum lewat)"
fi
exit 0
