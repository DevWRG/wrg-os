-- Cek migrasi 341 TERHADAP DATA ASLI tanpa meninggalkan jejak: simpan keluaran view lama ke tabel sementara,
-- jalankan berkas migrasi di DALAM transaksi, bandingkan, ukur, lalu ROLLBACK.
--   psql -d wrg_os_prod -f scripts/qa/kso-komite/cek_snapshot_bottomline.sql      (sebagai owner, dari akar repo)
-- Selama ±20 dtk transaksi memegang kunci view Bottom Line/Portofolio → jalankan di luar jam ramai.
-- Harapan: semua "beda_*" = 0.
\set ON_ERROR_STOP on
\pset pager off
begin;
set local statement_timeout = '180s';
\echo == ukur & simpan keluaran LAMA
\timing on
create temp table lama_unit as select * from public.kso_bottomline_unit_v;
create temp table lama_ringkas as select * from public.kso_jenis_ringkas_v;
create temp table lama_model as select * from public.kso_bottomline_model_v;
create temp table lama_porto as select * from public.kso_portofolio_unit_v;
\timing off
\echo == definisi kso_refresh_snapshots yang berlaku (harus = 188: dua REFRESH)
select (length(prosrc) - length(replace(lower(prosrc), 'refresh materialized view', ''))) / 25 as jumlah_refresh from pg_proc where proname = 'kso_refresh_snapshots';
\echo == jalankan migrasi 341
\ir ../../../infra/postgres/init/341_kso_snapshot_omzet_bottomline.sql
\echo == ukur BARU
\timing on
create temp table baru_unit as select * from public.kso_bottomline_unit_v;
create temp table baru_ringkas as select * from public.kso_jenis_ringkas_v;
create temp table baru_model as select * from public.kso_bottomline_model_v;
create temp table baru_porto as select * from public.kso_portofolio_unit_v;
\echo == refresh snapshot (biaya tambahan di akhir sinkron Accurate)
select kso_refresh_snapshots();
\timing off
\echo == beda (harus 0 semua)
select (select count(*) from (select * from lama_unit except all select * from baru_unit) x)
     + (select count(*) from (select * from baru_unit except all select * from lama_unit) x) as beda_unit,
       (select count(*) from (select * from lama_ringkas except all select * from baru_ringkas) x)
     + (select count(*) from (select * from baru_ringkas except all select * from lama_ringkas) x) as beda_ringkas,
       (select count(*) from (select * from lama_model except all select * from baru_model) x)
     + (select count(*) from (select * from baru_model except all select * from lama_model) x) as beda_model,
       (select count(*) from (select * from lama_porto except all select * from baru_porto) x)
     + (select count(*) from (select * from baru_porto except all select * from lama_porto) x) as beda_porto,
       (select count(*) from baru_model) as baris_model, (select count(*) from baru_porto) as baris_porto;
rollback;
