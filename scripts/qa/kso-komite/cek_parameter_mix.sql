-- Cek migrasi 342 TERHADAP DATA ASLI tanpa jejak: simpan keluaran kso_parameter_mix_v lama, jalankan migrasi di DALAM
-- transaksi, bandingkan, ukur, ROLLBACK. Harapan: beda = 0.
--   psql -d wrg_os_prod -f scripts/qa/kso-komite/cek_parameter_mix.sql      (sebagai owner, dari akar repo)
\set ON_ERROR_STOP on
\pset pager off
begin;
set local statement_timeout = '180s';
\echo == model yang disimpan tombol (kimia klinik/hemato/BG/elektrolit ber-model)
select count(*) as model_tombol from public.kso_analyzer where aktif and model_key is not null and kategori in ('HEMATO','CC','BG','ELEKTRO');
\timing on
\echo == simpan: cek model CARA LAMA (satu model_v per model) — contoh 3 model
select 1 from public.kso_bottomline_model_v where model_key = (select min(model_key) from public.kso_analyzer);
select 1 from public.kso_bottomline_model_v where model_key = (select max(model_key) from public.kso_analyzer);
select 1 from public.kso_bottomline_model_v where model_key = (select min(model_key) from public.kso_analyzer where kategori = 'CC');
\echo == simpan: cek model CARA BARU (sekali untuk semua)
select count(*) from public.kso_bottomline_model_v where model_key = any(array(select model_key from public.kso_analyzer where model_key is not null));
\echo == parameter_mix LAMA
create temp table lama_mix as select * from public.kso_parameter_mix_v;
\timing off
\ir ../../../infra/postgres/init/342_kso_parameter_mix_tanpa_unit_v.sql
\timing on
\echo == parameter_mix BARU
create temp table baru_mix as select * from public.kso_parameter_mix_v;
\timing off
\echo == beda (harus 0)
select (select count(*) from (select * from lama_mix except all select * from baru_mix) x)
     + (select count(*) from (select * from baru_mix except all select * from lama_mix) x) as beda_mix,
       (select count(*) from baru_mix) as baris_mix;
rollback;
