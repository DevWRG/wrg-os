#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# wa-bridge-standalone.sh — jalankan wa-bridge di luar pm2, rahasia dari .env.prod.
#
# Kenapa di luar pm2: di bawah pm2 tiap `openclaw message send` melambat ~4x
# (47-61 detik vs 13-21 detik) sampai melewati timeout, dan balasan hilang tanpa
# error yang berarti. Sebabnya BUKAN pm2 itu sendiri, melainkan QoS latar +
# I/O prioritas rendah yang macOS berikan ke proses keturunan daemon; openclaw
# sangat berat I/O (openclaw-agent.sqlite 52 MB). Karena itu LaunchAgent
# com.wrg.wabridge memakai ProcessType=Interactive — lihat CLAUDE.md.
#
# Rahasia TIDAK ditulis di berkas ini supaya bisa masuk git. Dua variabel beda
# nama antara bridge dan .env.prod, nilainya sama (diverifikasi lewat hash):
#   WA_BRIDGE_SECRET   <- WA_SEND_SECRET     (dipakai wrg-os api saat POST /send)
#   WRG_WEBHOOK_SECRET <- WA_WEBHOOK_SECRET  (dipakai bridge saat POST ke webhook)
# ─────────────────────────────────────────────────────────────────────────────
set -eu

ENV_PROD="${ENV_PROD:-$HOME/DevWRG/wrg-os/.env.prod}"
[ -f "$ENV_PROD" ] || { echo "FATAL: $ENV_PROD tidak ada" >&2; exit 1; }

# Ambil satu kunci dari .env.prod TANPA mengeksekusi berkasnya (aman terhadap
# isi tak terduga), buang kutip pembungkus bila ada.
ambil() {
  sed -n "s/^$1=//p" "$ENV_PROD" | head -1 | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'
}

# ── Rahasia & konfigurasi dari .env.prod ──
WA_BRIDGE_SECRET="$(ambil WA_SEND_SECRET)"
WRG_WEBHOOK_SECRET="$(ambil WA_WEBHOOK_SECRET)"
WRG_WEBHOOK_SECRET_DEV="$(ambil WRG_WEBHOOK_SECRET_DEV)"
WRG_WEBHOOK_URL_DEV="$(ambil WRG_WEBHOOK_URL_DEV)"
WA_DEV_GROUPS="$(ambil WA_DEV_GROUPS)"

# Gagal cepat kalau rahasianya kosong: lebih baik bridge tidak hidup daripada
# hidup lalu menolak semua permintaan API dengan 401 yang membingungkan.
[ -n "$WA_BRIDGE_SECRET" ]   || { echo "FATAL: WA_SEND_SECRET kosong di $ENV_PROD" >&2; exit 1; }
[ -n "$WRG_WEBHOOK_SECRET" ] || { echo "FATAL: WA_WEBHOOK_SECRET kosong di $ENV_PROD" >&2; exit 1; }

# ── Non-rahasia, sengaja literal supaya terbaca jelas ──
WRG_WEBHOOK_URL="${WRG_WEBHOOK_URL:-http://127.0.0.1:4100/webhooks/wa}"
WA_BRIDGE_PORT="${WA_BRIDGE_PORT:-18080}"
WA_BRIDGE_SEND_LIVE="${WA_BRIDGE_SEND_LIVE:-true}"
OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"

# PATH ditulis tetap, bukan warisan sesi. node@24 di depan: rilis openclaw
# 2026.9.x menolak lini Node 25 yang jadi `node` default di mesin ini.
PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HOME="${HOME:-/Users/development}"
TMPDIR="${TMPDIR:-/var/folders/d5/5h2hpmn9283_1s5lrwzq34sh0000gn/T/}"
LC_CTYPE="${LC_CTYPE:-UTF-8}"

export WA_BRIDGE_SECRET WRG_WEBHOOK_SECRET WRG_WEBHOOK_SECRET_DEV WRG_WEBHOOK_URL_DEV \
       WA_DEV_GROUPS WRG_WEBHOOK_URL WA_BRIDGE_PORT WA_BRIDGE_SEND_LIVE OPENCLAW_BIN \
       PATH HOME TMPDIR LC_CTYPE

cd "$HOME/DevWRG/wrg-os"
exec /opt/homebrew/bin/node infra/wa-bridge/bridge.mjs
