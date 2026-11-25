-- Cek kesetaraan migrasi 340: kso.bahan_gpm_model(model_key) vs kolom yang sama di public.kso_bottomline_model_v.
-- BACA SAJA (begin … rollback) — aman dijalankan di prod sebagai owner:
--   psql -d wrg_os_prod -f scripts/qa/kso-komite/cek_bahan_gpm_model.sql
-- Hasil yang diharapkan: "beda = 0". Baris yang dicetak = model yang angkanya berbeda (selisih hpp < 0,01 diabaikan:
-- view & fungsi sama-sama double precision, hanya urutan pembulatan yang bisa berbeda).
\timing on
begin transaction read only;
with v as (select * from public.kso_bottomline_model_v),
f as (select v.model_key, b.* from v left join lateral kso.bahan_gpm_model(v.model_key) b on true),
beda as (
  select v.model_key, v.hpp as hpp_view, f.hpp as hpp_fungsi, v.biaya_per_tes as biaya_view, f.biaya_per_tes as biaya_fungsi,
         v.satuan as satuan_view, f.satuan as satuan_fungsi
    from v join f using (model_key)
   where abs(coalesce(v.hpp, -1) - coalesce(f.hpp, -1)) >= 0.01
      or v.biaya_per_tes is distinct from f.biaya_per_tes
      or v.biaya_tetap_bulan is distinct from f.biaya_tetap_bulan
      or v.biaya_tetap_harian is distinct from f.biaya_tetap_harian
      or v.qc_bulan is distinct from f.qc_bulan
      or v.satuan is distinct from f.satuan
      or v.biaya_tangga is distinct from f.biaya_tangga
      or kso.satuan_model(v.model_key) is distinct from v.satuan)
select * from beda order by model_key;
select (select count(*) from public.kso_bottomline_model_v) as model_diperiksa,
       (select count(*) from public.kso_analyzer a where a.model_key is not null
           and not exists (select 1 from public.kso_bottomline_model_v v where v.model_key = a.model_key)
           and exists (select 1 from kso.bahan_gpm_model(a.model_key))) as fungsi_ada_view_tidak;
-- waktu: satu model lewat view (cara lama) vs fungsi (cara baru)
select count(*) from public.kso_bottomline_model_v where model_key = (select min(model_key) from public.kso_analyzer);
select count(*) from kso.bahan_gpm_model((select min(model_key) from public.kso_analyzer));
rollback;
