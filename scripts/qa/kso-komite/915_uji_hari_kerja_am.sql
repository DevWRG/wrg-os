-- Uji migrasi 282: AM mengisi hari kerja lewat #KSO (kso.lengkapi_draft) → GPM ikut. DB UJI saja, sesudah 914.
-- Tiruan 005: Z3 reagen 3.000/tes, QC 300 rb/bln, HPP 36 jt; reagen harian 20.000 (diisi di uji ini).
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d915 (k text primary key, v bigint);
do $$ declare x bigint; begin
  x := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  insert into uji.d915 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;
update public.kso_bottomline_model_v set biaya_tetap_harian = 20000 where model_key = 'M-Z3';

-- 1. tanpa isian hari kerja → default 25: 3.000 + (500 rb + 300 rb)/900 + 36 jt/(36·900) = 5.000
select uji.cek('Hari kerja tak disebut AM → default 25 (5.000/tes)',
   (select hari_kerja is null from kso.rencana_kso where id = (select v from uji.d915 where k='x'))
   and (select round(biaya_per_tes, 2) = 5000.00 from kso.hitung_gpm((select v from uji.d915 where k='x'))));

-- 2. AM: "hari kerja 30" → tersimpan, dinyatakan, biaya naik ke 5.111,11
select kso.lengkapi_draft((select v from uji.d915 where k='x'), '{"hari_kerja": 30}');
select uji.cek('Isian AM hari kerja 30 tersimpan & tercatat dinyatakan',
   (select hari_kerja = 30 and 'hari_kerja' = any(kolom_dinyatakan) from kso.rencana_kso where id = (select v from uji.d915 where k='x')));
select uji.cek('Hari kerja 30 → biaya per tes 5.111,11',
   (select round(biaya_per_tes, 2) = 5111.11 from kso.hitung_gpm((select v from uji.d915 where k='x'))));

-- 3. isian lain tanpa hari kerja → hari kerja tetap 30
select kso.lengkapi_draft((select v from uji.d915 where k='x'), '{"tenor_bulan": 48}');
select uji.cek('Isian lain tak menghapus hari kerja',
   (select hari_kerja = 30 and tenor_bulan = 48 from kso.rencana_kso where id = (select v from uji.d915 where k='x')));

select uji.harus_gagal('Hari kerja 0 dari WA ditolak',
   format($q$select kso.lengkapi_draft(%s, '{"hari_kerja": 0}')$q$, (select v from uji.d915 where k='x')), 'check');
update public.kso_bottomline_model_v set biaya_tetap_harian = null where model_key = 'M-Z3';
