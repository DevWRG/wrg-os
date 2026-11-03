#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# openclaw-tmp-clean.sh — buang folder openclaw-plugin-build-* basi di $TMPDIR.
#
# Latar: openclaw membuat folder build (±109 MB) per proses via mkdtemp dan
# menghapusnya di dispose(); proses yang mati duluan (mis. `openclaw message
# send` dari wa-bridge, timeout 120 s) meninggalkannya. Laju ±16 GB per hari
# kerja → disk penuh 15 Okt (Postgres prod mati), kambuh 26 & 31 Okt.
#
# PENTING: gateway openclaw MENJALANKAN kode (libsignal) dari folder build-nya
# sendiri, dan lsof tak cukup untuk mendeteksinya (node menutup berkas). Jadi
# yang dilindungi:
#   1. folder berumur < MIN_AGE_H jam;
#   2. folder yang dibuat di sekitar waktu mulai SETIAP proses openclaw yang
#      masih hidup (−PRE_SEC s/d +POST_SEC) — gateway dan CLI;
#   3. folder yang jadi cwd proses mana pun.
# Gateway tak terbaca (launchctl tanpa PID) → TIDAK menghapus apa pun.
# ~/.openclaw/media (foto WA) tak pernah disentuh — hanya $TMPDIR/openclaw-plugin-build-*.
#
# Dipanggil LaunchAgent tiap 3 jam (infra/launchd/com.wrg.openclaw-tmp-clean.plist).
# Uji: bash scripts/ops/openclaw-tmp-clean.sh --dry-run
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

MIN_AGE_H="${OPENCLAW_TMP_MIN_AGE_H:-6}"
PRE_SEC=120
POST_SEC=900
GATEWAY_LABEL="ai.openclaw.gateway"
OPS="$HOME/DevWRG/ops"
LOG="$OPS/openclaw-tmp-clean.log"

DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
mkdir -p "$OPS"
log() { local l; l="$(date '+%Y-%m-%d %H:%M:%S') ${DRY:+[dry-run] }$*"; echo "$l" >>"$LOG"; [ -n "$DRY" ] && echo "$l"; return 0; }

TMPD="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)"
if [ -z "$TMPD" ] || [ ! -d "$TMPD" ]; then log "TMPDIR tak terbaca — batal"; exit 1; fi
TMPD="${TMPD%/}"

# ── 1. Gateway wajib terbaca ──
GW_PID="$(launchctl list 2>/dev/null | awk -v l="$GATEWAY_LABEL" '$3==l{print $1}')"
case "$GW_PID" in ''|-|*[!0-9]*) log "PID gateway tak terbaca (launchctl: '${GW_PID:-}') — batal, tidak menghapus"; exit 0;; esac

# ── 2. Jendela lindung: waktu mulai setiap proses openclaw yang hidup ──
lstart_epoch() { LC_ALL=C date -j -f "%a %b %e %T %Y" "$1" +%s 2>/dev/null; }
STARTS=""
while read -r pid rest; do
  [ -z "$pid" ] && continue
  ep="$(lstart_epoch "$(LC_ALL=C ps -o lstart= -p "$pid" 2>/dev/null)")"
  [ -n "$ep" ] && STARTS="$STARTS $ep"
done < <(ps -axo pid=,command= | grep -i 'openclaw' | grep -v -e grep -e openclaw-tmp-clean)
GW_START="$(lstart_epoch "$(LC_ALL=C ps -o lstart= -p "$GW_PID" 2>/dev/null)")"
if [ -z "$GW_START" ]; then log "waktu mulai gateway PID $GW_PID tak terbaca — batal"; exit 0; fi
case " $STARTS " in *" $GW_START "*) ;; *) STARTS="$STARTS $GW_START";; esac

# cwd semua proses (sekali per run)
CWDS="$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | grep 'openclaw-plugin-build-' || true)"

NOW=$(date +%s)
CUTOFF=$((NOW - MIN_AGE_H * 3600))
FREE_BEFORE=$(df -k "$HOME" | awk 'NR==2{print $4}')

N_HAPUS=0; N_MUDA=0; N_LINDUNG=0; N_GAGAL=0
for d in "$TMPD"/openclaw-plugin-build-*; do
  [ -d "$d" ] || continue
  [ -L "$d" ] && continue
  b=$(stat -f %B "$d" 2>/dev/null) || continue
  if [ "$b" -ge "$CUTOFF" ]; then N_MUDA=$((N_MUDA + 1)); continue; fi
  lindung=""
  for s in $STARTS; do
    if [ "$b" -ge $((s - PRE_SEC)) ] && [ "$b" -le $((s + POST_SEC)) ]; then lindung=1; break; fi
  done
  if [ -z "$lindung" ] && [ -n "$CWDS" ] && grep -qF "$d" <<<"$CWDS"; then lindung=1; fi
  if [ -n "$lindung" ]; then
    N_LINDUNG=$((N_LINDUNG + 1)); log "lindung $(basename "$d") ($(date -r "$b" '+%F %T'))"; continue
  fi
  if [ -n "$DRY" ]; then
    N_HAPUS=$((N_HAPUS + 1))
  elif rm -rf -- "$d" 2>>"$LOG"; then
    N_HAPUS=$((N_HAPUS + 1))
  else
    N_GAGAL=$((N_GAGAL + 1))
  fi
done

FREE_AFTER=$(df -k "$HOME" | awk 'NR==2{print $4}')
log "gateway PID $GW_PID mulai $(date -r "$GW_START" '+%F %T') · proses openclaw: $(echo $STARTS | wc -w | tr -d ' ') · ${DRY:+akan }dihapus $N_HAPUS · muda(<${MIN_AGE_H}j) $N_MUDA · dilindungi $N_LINDUNG · gagal $N_GAGAL · bebas $((FREE_BEFORE / 1048576)) → $((FREE_AFTER / 1048576)) GB"
exit 0
