#!/usr/bin/env bash
# test-cek-wa.sh — simulasi WA inbound "#CEK <arg>" ke API lokal (pola sama
# spt trial #PLAN/#REPORT di docs/LOCAL-DEV.md — POST ke /webhooks/wa, tanpa
# gateway WA sungguhan). Cetak response JSON mentah dari server (untuk lihat
# teks balasan asli #CEK CUSTOMER, pakai apps/api/scripts/cek-reply.ts).
#
# Pemakaian:
#   bash scripts/dev/test-cek-wa.sh "CUSTOMER PT Testing"
#   bash scripts/dev/test-cek-wa.sh "SO-00123"          # varian nomor dokumen (F4)
#
# Prasyarat: pnpm dev jalan (api :4000), WA_INBOUND_PROCESS=true di .env,
# sender "Budi" resolve ke AM demo (seed-dev.sql).
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

ARG="${1:-}"
if [ -z "$ARG" ]; then
  echo 'Pemakaian: bash scripts/dev/test-cek-wa.sh "CUSTOMER <nama>"  (atau nomor dokumen)' >&2
  exit 1
fi

if ! grep -qE '^WA_INBOUND_PROCESS=true' .env 2>/dev/null; then
  echo "⚠️  WA_INBOUND_PROCESS bukan 'true' di .env — pesan akan ke-skip, tidak diproses." >&2
  echo "   Set WA_INBOUND_PROCESS=true di .env lalu restart pnpm dev, baru ulangi." >&2
  exit 1
fi

API_URL="${API_URL:-http://localhost:4000}"
# Escape backslash & double-quote supaya ARG dgn karakter itu tak merusak JSON.
ESCAPED=$(printf '%s' "#CEK ${ARG}" | sed 's/\\/\\\\/g; s/"/\\"/g')
BODY=$(cat <<JSON
{"group_jid":"120363000000000001@g.us","sender":"120363000000000001@g.us","sender_name":"Budi","body":"${ESCAPED}","message_id":"test-cek-$RANDOM"}
JSON
)

curl -s -X POST "$API_URL/webhooks/wa" -H 'content-type: application/json' -d "$BODY"
echo
