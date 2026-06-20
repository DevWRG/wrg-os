#!/usr/bin/env bash
# local-reset.sh — reset DB lokal (Docker) ke kondisi bersih: hapus volume →
# re-init schema dari infra/postgres/init/*.sql → seed demo.
#
# HANYA untuk DB lokal dev (Docker compose). JANGAN dipakai di server prod.
# Pakai:
#   bash scripts/db/local-reset.sh          # konfirmasi dulu
#   FORCE=1 bash scripts/db/local-reset.sh  # tanpa konfirmasi
#   NO_SEED=1 bash scripts/db/local-reset.sh # skip seed
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

command -v docker >/dev/null || { echo "ERROR: docker tak terpasang. Cara ini khusus setup Docker (lihat docs/LOCAL-DEV.md)."; exit 1; }

# safety: tolak kalau ini kelihatan seperti server prod
if pm2 list 2>/dev/null | grep -q 'wrg-prod-'; then
  echo "ABORT: terdeteksi service 'wrg-prod-*' (pm2) — ini kemungkinan SERVER prod. local-reset hanya untuk laptop dev."; exit 1
fi

VOL="wrg-os_pg_data"   # <project name 'wrg-os'>_<volume 'pg_data'>
echo "Akan: stop+hapus container postgres, HAPUS volume '$VOL' (semua data lokal hilang), re-init schema, seed."
if [ "${FORCE:-0}" != "1" ]; then
  read -r -p "Lanjut? (ketik 'ya'): " ans
  [ "$ans" = "ya" ] || { echo "dibatalkan."; exit 0; }
fi

echo "→ stop & remove postgres container..."
docker compose stop postgres 2>/dev/null || true
docker compose rm -sf postgres 2>/dev/null || true
echo "→ hapus volume $VOL..."
docker volume rm "$VOL" 2>/dev/null || echo "  (volume sudah tak ada)"
echo "→ up postgres (schema auto-apply dari init/*.sql)..."
docker compose up -d postgres

echo "→ tunggu DB ready..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "${PG_USER:-wrg}" >/dev/null 2>&1; then echo "  ready."; break; fi
  sleep 2
done

if [ "${NO_SEED:-0}" != "1" ]; then
  URL=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')
  if [ -n "$URL" ]; then
    echo "→ seed dev..."; psql "$URL" -f scripts/db/seed-dev.sql || echo "  (seed gagal — cek DATABASE_URL di .env, port 5433?)"
  else
    echo "  (DATABASE_URL kosong di .env — skip seed; jalankan manual: psql \"\$DATABASE_URL\" -f scripts/db/seed-dev.sql)"
  fi
fi
echo "✓ local DB reset selesai."
