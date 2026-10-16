#!/usr/bin/env bash
# F170 Komite KSO — uji alur (900) + uji hak akses (901) terhadap BERKAS MIGRASI ASLI 224–227.
#
# Pakai: PGHOST=... PGPORT=... PGUSER=... bash scripts/qa/kso-komite/jalankan_uji.sh
# Membuat database sekali pakai `kso_komite_uji` (DROP + CREATE), tidak menyentuh database lain.
# Role wrg_app/wrg_readonly dibuat bila belum ada (tingkat cluster, sama seperti migrasi 039).
# Uji meninggalkan baris data + schema `uji` → JANGAN diarahkan ke wrg_os_dev / wrg_os_prod.
set -euo pipefail
cd "$(dirname "$0")"
INIT=../../../infra/postgres/init
DB=kso_komite_uji

if psql -d postgres -Atc "select 1 from pg_database where datname = 'wrg_os_prod'" | grep -q 1; then
  echo "BERHENTI: server ini memuat wrg_os_prod. Uji hanya untuk server lokal/sekali pakai." >&2
  exit 2
fi

psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB" -c "create database $DB" \
  -c "do \$\$ begin
        if not exists (select from pg_roles where rolname = 'wrg_app') then create role wrg_app login; end if;
        if not exists (select from pg_roles where rolname = 'wrg_readonly') then create role wrg_readonly login; end if;
      end \$\$"

# urutan sama dengan migrate.sh: satu berkas = satu transaksi
for f in "$INIT"/224_kso_komite_skema.sql "$INIT"/225_kso_komite_fungsi.sql \
         "$INIT"/226_kso_komite_view.sql "$INIT"/227_kso_komite_akses.sql; do
  psql -d $DB -q -1 -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -d $DB -q -v ON_ERROR_STOP=1 -f 004_data_contoh.sql >/dev/null

strip() { sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR): +//'; }
{
  psql -d $DB -q -f 900_uji.sql 2>&1 | strip
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 901_uji_akses_wrg.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *u-" || true
} | tee /dev/stderr | awk '/^LULUS/{l++} /^GAGAL/{g++} END{printf "\nRingkasan: %d LULUS, %d GAGAL\n", l, g; exit (g>0 || l==0)}'
