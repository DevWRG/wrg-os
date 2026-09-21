#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# wa-inbound-watchdog.sh — deteksi KEGAGALAN SENYAP jalur masuk WhatsApp.
#
# Latar: 21 Sep 2026 dua outage terbesar sama-sama tidak terdeteksi sistem —
# gateway "healthy", WhatsApp "linked", total pesan harian tampak normal (556),
# tapi (a) balasan mati ~15 jam dan (b) inbound mati 47 menit. Keduanya
# ditemukan manusia dengan membuka grup satu per satu. Watchdog ini menutup
# kelas kegagalan itu: ia tidak peduli komponen mana yang rusak, hanya bertanya
# "apakah pesan masih mendarat di wa_message?".
#
# Ambang 45 menit diturunkan dari data 21 hari (Sen-Sab, 08-16 WIB):
#   p99 = 12 menit · p99.9 = 57 menit · jeda >45 menit hanya 8x/21 hari
# Cukup jarang untuk tetap dipercaya, cukup peka untuk menangkap outage 56
# menit seperti 21 Sep.
#
# TIGA saluran alert, sengaja tidak bergantung pada WA saja — alarm soal WA
# yang dikirim lewat WA itu sirkular dan pernah gagal senyap total (69 alarm
# masuk failed/, Jul-Agu 2026):
#   1. berkas log  (SELALU, tak bisa gagal)
#   2. notifikasi macOS (terlihat di layar tanpa jaringan)
#   3. WA ke owner (best-effort; berguna saat yang mati inbound, bukan outbound)
#
# Juga membedakan LAPISAN yang mati, supaya alertnya bisa langsung ditindak:
#   capture segar + wa_message basi  -> bridge gagal meneruskan
#   capture basi  + wa_message basi  -> openclaw berhenti menangkap (tap/gateway)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# ── Konfigurasi ──
AMBANG_MENIT="${WA_WATCH_AMBANG:-45}"
JAM_MULAI="${WA_WATCH_JAM_MULAI:-8}"      # inklusif, WIB
JAM_SELESAI="${WA_WATCH_JAM_SELESAI:-17}" # inklusif
COOLDOWN_MENIT="${WA_WATCH_COOLDOWN:-60}"
# Ambang kesegaran capture BERDIRI SENDIRI: kalau ikut $AMBANG_MENIT, menurunkan
# ambang pesan (mis. saat menguji) ikut mendistorsi diagnosa lapisan.
AMBANG_CAPTURE="${WA_WATCH_AMBANG_CAPTURE:-45}"
DB_USER="wrg_readonly"
DB_NAME="wrg_os_prod"
CAPTURE_ROOT="$HOME/.openclaw/tmp/wrg-monitor/messages"
BRIDGE_SEND="http://127.0.0.1:18080/send"
ALERT_WA="+6285733048855"
LOG="$HOME/DevWRG/ops/logs/wa-inbound-watchdog.log"
STATE="$HOME/DevWRG/ops/logs/wa-inbound-watchdog.state"

mkdir -p "$(dirname "$LOG")"
catat() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# ── Hanya jam kerja Sen-Sab ──
dow=$(date +%u)   # 1=Sen .. 7=Min
jam=$(date +%-H)
if [ "$dow" -eq 7 ] || [ "$jam" -lt "$JAM_MULAI" ] || [ "$jam" -gt "$JAM_SELESAI" ]; then
  exit 0
fi

# ── Berapa menit sejak pesan terakhir? ──
usia=$(psql -U "$DB_USER" -d "$DB_NAME" -At -c \
  "SELECT coalesce(round(EXTRACT(epoch FROM (now() - max(received_at)))/60)::int, 99999) FROM wa_message;" 2>/dev/null)

if ! [[ "$usia" =~ ^[0-9]+$ ]]; then
  # DB sendiri tak terjawab — itu pun kegagalan yang layak dilaporkan.
  usia=-1
fi

if [ "$usia" -ge 0 ] && [ "$usia" -lt "$AMBANG_MENIT" ]; then
  rm -f "$STATE"          # sehat: reset debounce
  exit 0
fi

# ── Debounce: butuh 2 cek berturut sebelum berteriak (redam blip sesaat) ──
gagal_ke=1
[ -f "$STATE" ] && gagal_ke=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$gagal_ke" > "$STATE"
if [ "$gagal_ke" -lt 2 ]; then
  catat "WARN usia=${usia}mnt (cek ke-1, menunggu konfirmasi cek berikutnya)"
  exit 0
fi

# ── Cooldown anti-spam ──
TANDA="${STATE}.terakhir-alert"
if [ -f "$TANDA" ]; then
  lalu=$(( ( $(date +%s) - $(stat -f %m "$TANDA") ) / 60 ))
  [ "$lalu" -lt "$COOLDOWN_MENIT" ] && { catat "SENYAP usia=${usia}mnt (cooldown, ${lalu}mnt sejak alert terakhir)"; exit 0; }
fi
touch "$TANDA"

# ── Bedakan lapisan yang mati ──
hari_utc=$(date -u +%F)
capture_usia="?"
if [ -d "$CAPTURE_ROOT/$hari_utc" ]; then
  terbaru=$(ls -t "$CAPTURE_ROOT/$hari_utc" 2>/dev/null | head -1)
  if [ -n "$terbaru" ]; then
    capture_usia=$(( ( $(date +%s) - $(stat -f %m "$CAPTURE_ROOT/$hari_utc/$terbaru") ) / 60 ))
  fi
fi

if [ "$usia" -lt 0 ]; then
  diagnosa="DB wrg_os_prod tidak menjawab — periksa postgres."
elif [[ "$capture_usia" =~ ^[0-9]+$ ]] && [ "$capture_usia" -lt "$AMBANG_CAPTURE" ]; then
  diagnosa="openclaw MASIH menangkap (capture ${capture_usia}mnt lalu) tapi tak sampai ke DB → curigai wa-bridge forwarder / webhook wrg-os."
else
  diagnosa="capture juga basi (${capture_usia}mnt) → curigai openclaw gateway atau tap WRG_MONITOR_TAP_V1 (jalankan wrg-monitor/scripts/reapply-patch.sh)."
fi

PESAN="⚠️ *Inbound WhatsApp senyap*
Tidak ada pesan masuk di wa_message selama *${usia} menit* (ambang ${AMBANG_MENIT}).

${diagnosa}

Cek: openclaw health · curl -s localhost:18080/health"

# 1) log — saluran yang tak bisa gagal
catat "ALARM usia=${usia}mnt capture=${capture_usia}mnt :: ${diagnosa}"

# 2) notifikasi macOS — terlihat tanpa jaringan
osascript -e "display notification \"Inbound WA senyap ${usia} menit\" with title \"WRG OS\" sound name \"Basso\"" >/dev/null 2>&1

# 3) WA best-effort — berguna saat yang mati inbound, bukan outbound
SEC=""
[ -f "$HOME/DevWRG/wrg-os/.env.prod" ] && SEC=$(grep -E '^WA_SEND_SECRET=' "$HOME/DevWRG/wrg-os/.env.prod" | head -1 | cut -d= -f2-)
if [ -n "$SEC" ]; then
  hasil=$(curl -sS -m 150 -X POST "$BRIDGE_SEND" -H 'content-type: application/json' \
    -H "x-wa-secret: $SEC" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"to": sys.argv[1], "message": sys.argv[2]}))' "$ALERT_WA" "$PESAN")" 2>&1)
  case "$hasil" in
    *'"sent":true'*) catat "  alert WA terkirim" ;;
    *)               catat "  alert WA GAGAL (wajar bila outbound ikut mati): $(printf '%s' "$hasil" | head -c 120)" ;;
  esac
else
  catat "  alert WA dilewati: WA_SEND_SECRET tak terbaca dari .env.prod"
fi

exit 0
