#!/usr/bin/env bash
# F170 Komite KSO (v2 GPM + zona sejak 265/266) — uji alur (900) + hak akses (901) + referensi OS (902) + lengkapi draft (903) + peran Akses Grup (904) + jadwal (905) + label & KPI (906) + tautan HOD (907) + Sekretariat & Susunan (908) + akses zona v2 (909) + zona ulang & pembuka Direksi (910) + pembuka ≥ usulan AM (911) + volume turun (912) + mandat untuk deal Pipeline (913) + bottom dinamis (914) + hari kerja AM (915) + tangga cartridge (916) + Agenda A terverifikasi (917) + fee & lampiran PDF (918) + faskes baru (919) + kota area AM (920) terhadap BERKAS MIGRASI ASLI 224–233 + 242.
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
         "$INIT"/226_kso_komite_view.sql "$INIT"/227_kso_komite_akses.sql \
         "$INIT"/228_kso_komite_referensi_os.sql "$INIT"/229_kso_komite_lengkapi_draft.sql \
         "$INIT"/230_kso_komite_peran_akses_grup.sql \
         "$INIT"/231_kso_komite_jadwal.sql "$INIT"/232_kso_komite_label_sumber.sql "$INIT"/233_kso_komite_hod_akun.sql \
         "$INIT"/242_kso_komite_sekretariat_susunan.sql \
         "$INIT"/265_kso_komite_zona_enum.sql "$INIT"/266_kso_komite_gpm_zona.sql \
         "$INIT"/267_kso_komite_bot_tujuh_isian.sql "$INIT"/268_kso_komite_angka_gpm_layar.sql \
         "$INIT"/269_kso_komite_zona_ulang_pembuka.sql "$INIT"/272_kso_komite_pembuka_min_usulan_am.sql \
         "$INIT"/278_kso_komite_volume_turun.sql "$INIT"/280_kso_mandat_untuk_deal.sql \
         "$INIT"/281_kso_bottom_dinamis_pricebook.sql \
         "$INIT"/282_kso_komite_hari_kerja_am.sql \
         "$INIT"/284_kso_biaya_kk_bg.sql \
         "$INIT"/285_kso_agenda_a_terverifikasi.sql \
         "$INIT"/286_kso_bottomline_alat_baru.sql \
         "$INIT"/288_kso_biaya_elektrolit.sql \
         "$INIT"/302_kso_format_wa_lampiran.sql "$INIT"/303_kso_faskes_baru.sql \
         "$INIT"/304_kso_faskes_baru_kota_area.sql; do
  psql -d $DB -q -1 -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -d $DB -q -v ON_ERROR_STOP=1 -f 004_data_contoh.sql >/dev/null
# F170 v2 (265/266): tiruan tabel F172/F145 di public (angka fiktif) — sumber GPM & zona
psql -d $DB -q -v ON_ERROR_STOP=1 -f 005_tiruan_bottomline.sql >/dev/null

# NOTICE "LULUS …" → apa adanya. ERROR "GAGAL: …" (uji.cek) → apa adanya. ERROR lain (galat SQL
# yang menghentikan berkas uji) → dihitung GAGAL; kalau tidak, uji sesudahnya hilang tanpa suara.
strip() { sed -E -e 's/^psql:[^:]+:[0-9]+: NOTICE: +//' \
                 -e 's/^psql:[^:]+:[0-9]+: ERROR: +(GAGAL)/\1/' \
                 -e 's/^psql:[^:]+:[0-9]+: ERROR: +/GAGAL (galat SQL): /'; }
{
  psql -d $DB -q -f 900_uji.sql 2>&1 | strip
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 901_uji_akses_wrg.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *u-" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 902_uji_referensi.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|segarkan_referensi) *$|^ *\{" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 903_uji_lengkapi_draft.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *(bot-wa|u-am01|app_bot_lengkapi_draft) *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 904_uji_peran_akses_grup.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^ *(AM-01|HA-BAR) *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 905_uji_jadwal.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|app_job_batal_notif) *$|^ *[a-z0-9-]{3,40} *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 906_uji_label_kpi.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *cek *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 907_uji_hod_akun.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 908_uji_sekretariat_susunan.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 909_uji_zona_v2_akses.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 910_uji_zona_ulang_pembuka.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 911_uji_pembuka_usulan_am.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 912_uji_volume_turun.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 913_uji_mandat_untuk_deal.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 914_uji_bottom_dinamis.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 915_uji_hari_kerja_am.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|lengkapi_draft) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 916_uji_biaya_tangga.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|lengkapi_draft) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 917_uji_agenda_terverifikasi.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|lengkapi_draft) *$|^ *[a-z0-9-]{3,40} *$|^UPDATE [0-9]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 918_uji_fee_lampiran.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|lengkapi_draft|app_bot_catat_lampiran|app_bot_simpan_tertunda) *$|^ *[a-z0-9-]{3,40} *$|^ *[0-9]+ *$|^UPDATE [0-9]+$|^INSERT [0-9 ]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 919_uji_faskes_baru.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|harus_gagal|set_config|segarkan_referensi|app_bot_tertunda_isi|app_bot_tertunda_simpan|am|AM-[0-9]+) *$|^ *[a-z0-9-]{3,40} *$|^ *[0-9]+ *$|^ *\{|^UPDATE [0-9]+$|^INSERT [0-9 ]+$" || true
  psql -d $DB -q -v ON_ERROR_STOP=1 -f 920_uji_kota_area_am.sql 2>&1 | strip \
    | grep -vE "^ *$|^-+$|^\(1 row\)|^ *(cek|set_config) *$|^ *[a-z0-9-]{3,40} *$|^INSERT [0-9 ]+$" || true
} | tee /dev/stderr | awk '/^LULUS/{l++} /^GAGAL/{g++} END{printf "\nRingkasan: %d LULUS, %d GAGAL\n", l, g; exit (g>0 || l==0)}'
