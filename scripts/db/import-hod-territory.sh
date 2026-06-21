#!/usr/bin/env bash
# import-hod-territory.sh — impor mapping HoD→cabang ke tabel hod_territory.
# Sumber: CSV export dari AREA PER HOD.xlsx (canonical 62 AM-territory).
#
# Format CSV (header wajib):
#   hod_key,cabang
#   rocky,Malang
#   rocky,Kediri
#   yogi,Surabaya
#   ...
# (satu baris per pasangan HoD↔cabang)
#
# Pemilihan DB (sama spt migrate.sh):
#   1) $DATABASE_URL bila di-set
#   2) --prod → owner via socket (DDL/DML-capable), DB dari .env.prod
#   3) default → DATABASE_URL dari .env (local dev)
#
# Pemakaian:
#   bash scripts/db/import-hod-territory.sh path/to/territory.csv
#   bash scripts/db/import-hod-territory.sh path/to/territory.csv --prod
#   REPLACE=1 bash scripts/db/import-hod-territory.sh file.csv   # kosongkan dulu baru impor
set -euo pipefail
cd "$(dirname "$0")/../.."

CSV=""; USE_PROD=0
for a in "$@"; do case "$a" in
  --prod) USE_PROD=1 ;;
  *.csv)  CSV="$a" ;;
  *) echo "arg tak dikenal: $a"; exit 2 ;;
esac; done
[ -z "$CSV" ] && { echo "ERROR: kasih path CSV. Lihat header file ini utk format."; exit 2; }
[ -f "$CSV" ] || { echo "ERROR: file tak ada: $CSV"; exit 1; }

# ── resolve DATABASE_URL ──
if [ -n "${DATABASE_URL:-}" ]; then URL="$DATABASE_URL"
elif [ "$USE_PROD" = 1 ]; then
  DB=$(grep -E '^DATABASE_URL=' .env.prod 2>/dev/null | sed -E 's#.*/([^/?]+).*#\1#' || true)
  URL="postgres:///${DB:-wrg_os_prod}"   # socket → peer (owner)
else URL=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'); fi
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL tak ketemu (set env, atau --prod, atau isi .env)."; exit 1; }
echo "Target DB: $(echo "$URL" | sed -E 's#://[^@]*@#://***@#')"

REPLACE="${REPLACE:-0}"
psql "$URL" -v ON_ERROR_STOP=1 -q <<SQL
CREATE TEMP TABLE _imp (hod_key text, cabang text);
\copy _imp FROM '$CSV' WITH (FORMAT csv, HEADER true)
$( [ "$REPLACE" = 1 ] && echo "TRUNCATE hod_territory;" )
INSERT INTO hod_territory (hod_key, cabang, source, updated_at)
  SELECT lower(trim(hod_key)), trim(cabang), 'import', now()
  FROM _imp WHERE coalesce(trim(cabang),'') <> ''
  ON CONFLICT (hod_key, cabang) DO UPDATE SET updated_at = now();
SQL

echo "✓ impor selesai. Isi hod_territory:"
psql "$URL" -At -c "SELECT hod_key, count(*)||' cabang' FROM hod_territory GROUP BY hod_key ORDER BY hod_key;"
