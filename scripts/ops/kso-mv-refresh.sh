#!/usr/bin/env bash
# Segarkan snapshot produktivitas KSO (migrasi 185) SEKARANG, tanpa menunggu
# sinkron Accurate berikutnya.
#
# Jalur normalnya bukan ini: refresh sudah menempel di akhir job accurate-sync
# (apps/api/src/scheduler.ts), jadi snapshot mengikuti kesegaran sumbernya
# sendiri. Skrip ini untuk dua keadaan: sesudah impor/perbaikan data manual,
# dan saat scheduler mati (ACCURATE_SCHEDULE_ENABLED=false).
#
# CONCURRENTLY: pembacaan /kso-produktivitas tidak terkunci selama refresh.
set -euo pipefail
DB="${1:-wrg_os_prod}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "→ REFRESH kso_asset_produktivitas_mv di $DB …"
T0=$(date +%s)
psql -X -q -v ON_ERROR_STOP=1 "postgres:///$DB" \
  -c "REFRESH MATERIALIZED VIEW CONCURRENTLY kso_asset_produktivitas_mv"
echo "✓ selesai dalam $(( $(date +%s) - T0 )) dtk"
psql -X -q -P pager=off "postgres:///$DB" \
  -c "SELECT count(*) AS baris_snapshot FROM kso_asset_produktivitas_mv"
