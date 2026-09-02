#!/usr/bin/env bash
# demo-provision.sh — bangun ULANG database DEMO dari nol dengan data SINTETIS.
# Dipakai saat setup awal dan untuk reseed berkala (demo selalu bersih & tanggal
# tak basi, karena seed banyak memakai now()/CURRENT_DATE).
#
#   bash scripts/ops/demo-provision.sh            # konfirmasi dulu
#   FORCE=1 bash scripts/ops/demo-provision.sh    # tanpa konfirmasi (cron)
#
# AMAN: menolak jalan kalau target bukan database bernama *_demo.
# Data dummy-nya SATU SUMBER dengan dev: scripts/db/seed-dev.sql (roster+plan)
# lalu scripts/db/seed-dev-full.sql (67 tabel). Urutan itu WAJIB — seed-dev-full
# merujuk am_id demo1/demo2/demo3 yang dibuat seed-dev.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${DEMO_DB:-wrg_os_demo}"
case "$DB" in
  *_demo) ;;
  *) echo "ABORT: DEMO_DB='$DB' bukan database *_demo. Menolak menghapus."; exit 1 ;;
esac

if [ "${FORCE:-0}" != "1" ]; then
  echo "Akan MENGHAPUS database '$DB' lalu membangunnya ulang (semua data demo hilang)."
  read -r -p "Lanjut? (ketik 'ya'): " ans
  [ "$ans" = "ya" ] || { echo "dibatalkan."; exit 0; }
fi

echo "→ drop & create $DB ..."
dropdb --if-exists "$DB"
createdb "$DB"

echo "→ migrasi schema ($(ls infra/postgres/init/*.sql | wc -l | tr -d ' ') file) ..."
DATABASE_URL="postgres:///$DB" bash scripts/db/migrate.sh

echo "→ seed data sintetis (sama dengan dev) ..."
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/db/seed-dev.sql
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/db/seed-dev-full.sql

echo "→ grant ulang ke role aplikasi demo ..."
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "
  GRANT CONNECT ON DATABASE $DB TO wrg_demo_app;
  GRANT USAGE ON SCHEMA public TO wrg_demo_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wrg_demo_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wrg_demo_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wrg_demo_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wrg_demo_app;"

echo "→ akun login demo ..."
# app_user TIDAK diseed lewat SQL (password = scrypt, dibuat aplikasi). Setelah
# DB kosong dari user, endpoint /auth/register terbuka sebagai bootstrap sekali pakai.
if [ -n "${DEMO_ADMIN_EMAIL:-}" ] && [ -n "${DEMO_ADMIN_PASSWORD:-}" ]; then
  curl -fsS -X POST "http://127.0.0.1:${DEMO_API_PORT:-4200}/auth/register" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$DEMO_ADMIN_EMAIL\",\"password\":\"$DEMO_ADMIN_PASSWORD\",\"name\":\"Akun Demo\",\"role\":\"admin\"}" \
    >/dev/null && echo "  akun admin demo dibuat: $DEMO_ADMIN_EMAIL"
else
  echo "  SKIP — set DEMO_ADMIN_EMAIL & DEMO_ADMIN_PASSWORD untuk membuat akun otomatis."
fi

echo "✓ demo siap. Restart aplikasi: pm2 restart ecosystem.demo.config.cjs --update-env"
