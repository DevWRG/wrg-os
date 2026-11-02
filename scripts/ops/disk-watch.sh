#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# disk-watch.sh — alert WA kalau sisa disk Mac mini (prod+dev+demo) menipis.
#
# Latar: 15 Okt 2026 disk penuh → Postgres prod mati 17:59–19:46 WIB. Biangnya
# folder openclaw-plugin-build-* di $TMPDIR (±16 GB per hari kerja) + backup
# predeploy. Kambuh 26 Okt (86%) dan 31 Okt (81%); tiap kali baru ketahuan saat
# sudah dekat penuh. Skrip ini MEMBERI TAHU — tidak menghapus apa pun.
#
# Level (sisa ruang di volume $HOME):
#   ok       ≥ WARN_GB
#   waspada  < WARN_GB   → WA, diulang tiap WARN_REPEAT_SEC selama bertahan
#   kritis   < CRIT_GB   → WA, diulang tiap CRIT_REPEAT_SEC selama bertahan
#   kembali ok dari waspada/kritis → satu WA "pulih"
#
# Tujuan WA dibaca dari .env.prod: DISK_ALERT_TO, kalau kosong WRG_DEPLOY_ALERT_TO.
# Kosong keduanya → log saja.
#
# Dipanggil cron tiap 15 menit:
#   */15 * * * * /bin/bash $HOME/DevWRG/wrg-os/scripts/ops/disk-watch.sh
# Uji manual:
#   bash scripts/ops/disk-watch.sh --dry-run   # cetak status + pesan, tanpa kirim
#   bash scripts/ops/disk-watch.sh --test      # paksa kirim satu WA (cek jalur)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# ── Konfigurasi ──
WARN_GB="${DISK_WARN_GB:-30}"       # ±2 hari kerja pada laju bocor 16 GB/hari
CRIT_GB="${DISK_CRIT_GB:-12}"
WARN_REPEAT_SEC=21600               # 6 jam
CRIT_REPEAT_SEC=3600                # 1 jam
DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
OPS="$HOME/DevWRG/ops"
STATE="$OPS/.disk-watch-state"
LOG="$OPS/disk-watch.log"
BACKUP_DIR="$OPS/db-backups"
HOST_LABEL="Mac mini"

MODE="${1:-}"
mkdir -p "$OPS"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }
prod_env() { grep -E "^$1=" "$DIR/.env.prod" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

# State = baris key=value (tanpa python supaya tetap jalan saat disk nyaris penuh).
state_get() { grep -E "^$1=" "$STATE" 2>/dev/null | tail -1 | cut -d= -f2-; }
state_put() { # key=value ...
  local tmp="$STATE.tmp" kv k
  cp "$STATE" "$tmp" 2>/dev/null || : >"$tmp"
  for kv in "$@"; do
    k="${kv%%=*}"
    grep -vE "^$k=" "$tmp" >"$tmp.2" 2>/dev/null; mv "$tmp.2" "$tmp"
    echo "$kv" >>"$tmp"
  done
  mv "$tmp" "$STATE"
}

wa_send() { # $1 = pesan → rc 0 kalau gateway menjawab 2xx (= masuk antrean, belum tentu sampai)
  local to url sec
  to="$(prod_env DISK_ALERT_TO)"; [ -z "$to" ] && to="$(prod_env WRG_DEPLOY_ALERT_TO)"
  url="$(prod_env WA_SEND_URL)"; sec="$(prod_env WA_SEND_SECRET)"
  if [ -z "$url" ] || [ -z "$to" ]; then
    log "WA dilewati — WA_SEND_URL / DISK_ALERT_TO / WRG_DEPLOY_ALERT_TO kosong di .env.prod"
    return 1
  fi
  WA_URL="$url" WA_SEC="$sec" WA_TO="$to" WA_MSG="$1" python3 - >>"$LOG" 2>&1 <<'PY'
import os, json, sys, urllib.request
h = {"content-type": "application/json"}
if os.environ.get("WA_SEC"):
    h["x-wa-secret"] = os.environ["WA_SEC"]
req = urllib.request.Request(os.environ["WA_URL"], headers=h,
    data=json.dumps({"to": os.environ["WA_TO"], "message": os.environ["WA_MSG"]}).encode())
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print(f"WA HTTP {r.status}"); sys.exit(0 if 200 <= r.status < 300 else 1)
except Exception as e:
    print(f"WA gagal: {e}"); sys.exit(1)
PY
}

# ── 1. Ukur ──
# df -k kolom 4 = sisa KB untuk user (macOS: volume Data tempat $HOME berada).
read -r TOTAL_KB AVAIL_KB < <(df -k "$HOME" | awk 'NR==2{print $2, $4}')
if [ -z "${AVAIL_KB:-}" ]; then log "df gagal dibaca"; exit 1; fi
FREE_GB=$((AVAIL_KB / 1048576))
USED_PCT=$(( (TOTAL_KB - AVAIL_KB) * 100 / TOTAL_KB ))
NOW=$(date +%s)

LEVEL=ok
[ "$FREE_GB" -lt "$WARN_GB" ] && LEVEL=waspada
[ "$FREE_GB" -lt "$CRIT_GB" ] && LEVEL=kritis

# Laju: bandingkan dengan sampel ±24 jam lalu (sampel digeser sekali sehari).
REF_TS=$(state_get ref_ts); REF_GB=$(state_get ref_free_gb)
if [ -z "$REF_TS" ] || [ $((NOW - REF_TS)) -ge 86400 ]; then
  PREV_REF_TS="$REF_TS"; PREV_REF_GB="$REF_GB"
  state_put "ref_ts=$NOW" "ref_free_gb=$FREE_GB"
  REF_TS="$PREV_REF_TS"; REF_GB="$PREV_REF_GB"
fi
LAJU=""
if [ -n "$REF_TS" ] && [ -n "$REF_GB" ] && [ $((NOW - REF_TS)) -ge 3600 ]; then
  JAM=$(( (NOW - REF_TS) / 3600 ))
  TURUN=$((REF_GB - FREE_GB))
  if [ "$TURUN" -gt 0 ]; then
    HARI_X10=$(( FREE_GB * 10 * JAM / (TURUN * 24) ))
    LAJU="Turun ${TURUN} GB dalam ${JAM} jam → perkiraan penuh ±$((HARI_X10 / 10)),$((HARI_X10 % 10)) hari lagi."
  else
    LAJU="Tidak turun dalam ${JAM} jam terakhir."
  fi
fi

# Petunjuk penyebab — murah: hitung folder (maxdepth 1), du hanya di folder backup.
TMPD="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)"
N_BUILD=$(find "${TMPD:-/nonexistent}" -maxdepth 1 -name 'openclaw-plugin-build-*' 2>/dev/null | wc -l | tr -d ' ')
BACKUP_GB="?"
[ -d "$BACKUP_DIR" ] && BACKUP_GB=$(du -sk "$BACKUP_DIR" 2>/dev/null | awk '{printf "%.1f", $1/1048576}')

PESAN_RINCI="Sisa ${FREE_GB} GB (terpakai ${USED_PCT}%).
${LAJU:+$LAJU
}Folder openclaw-plugin-build-*: ${N_BUILD} · backup DB: ${BACKUP_GB} GB."

# ── 2. Putuskan ──
PREV=$(state_get level); PREV="${PREV:-ok}"
LAST_ALERT=$(state_get last_alert_ts); LAST_ALERT="${LAST_ALERT:-0}"
KIRIM=""; PESAN=""
case "$LEVEL" in
  kritis)
    if [ "$PREV" != kritis ] || [ $((NOW - LAST_ALERT)) -ge "$CRIT_REPEAT_SEC" ]; then
      KIRIM=1
      PESAN="🔴 *DISK KRITIS — ${HOST_LABEL}* (prod+dev+demo)
${PESAN_RINCI}
Di bawah ${CRIT_GB} GB. Disk penuh = Postgres prod mati (kejadian 15 Okt). Bersihkan folder build openclaw yang lebih tua dari waktu mulai gateway sekarang juga."
    fi ;;
  waspada)
    if [ "$PREV" = ok ] || [ $((NOW - LAST_ALERT)) -ge "$WARN_REPEAT_SEC" ]; then
      KIRIM=1
      PESAN="🟠 *Disk menipis — ${HOST_LABEL}*
${PESAN_RINCI}
Di bawah ${WARN_GB} GB. Jadwalkan pembersihan folder build openclaw."
    fi ;;
  ok)
    if [ "$PREV" != ok ]; then
      KIRIM=1
      PESAN="✅ Disk ${HOST_LABEL} kembali aman — sisa ${FREE_GB} GB (terpakai ${USED_PCT}%)."
    fi ;;
esac

if [ "$MODE" = "--test" ]; then
  KIRIM=1
  PESAN="🧪 Uji disk-watch — ${HOST_LABEL}, level: ${LEVEL}
${PESAN_RINCI}"
fi

if [ "$MODE" = "--dry-run" ]; then
  echo "level=$LEVEL (sebelumnya $PREV) free=${FREE_GB}GB used=${USED_PCT}% kirim=${KIRIM:-0}"
  echo "${PESAN_RINCI}"
  [ -n "$PESAN" ] && printf -- '--- pesan ---\n%s\n' "$PESAN"
  exit 0
fi

# ── 3. Bertindak ──
log "level=$LEVEL free=${FREE_GB}GB used=${USED_PCT}% build_dirs=$N_BUILD"
if [ -n "$KIRIM" ]; then
  if wa_send "$PESAN"; then
    log "WA $LEVEL masuk antrean gateway"
    state_put "last_alert_ts=$NOW"
  else
    log "WA $LEVEL GAGAL — dicoba lagi di siklus berikut"
    # level TIDAK dicatat → siklus berikut mencoba kirim lagi
    [ "$MODE" = "--test" ] || exit 0
  fi
fi
[ "$MODE" = "--test" ] || state_put "level=$LEVEL"
exit 0
