-- Uji migrasi 281: bottom per tes dinamis — tes per bulan, hari kerja, masa KSO (keputusan user 6 Nov 2026).
-- DB UJI saja, sesudah 900–913. Tiruan 005: Z3 reagen 3.000/tes, tetap 200 rb/bln, QC 300 rb/bln, HPP 36 jt.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d914 (k text primary key, v bigint);
do $$ declare x bigint; begin
  x := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  insert into uji.d914 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;

-- 1. harian kosong → pakai tetap per bulan (perilaku lama): 3.000 + 500.000/900 + 36 jt/(36·900) = 4.666,67
select uji.cek('Harian kosong → biaya tetap per bulan dipakai (4.666,67/tes)',
   (select round(biaya_per_tes, 2) = 4666.67 from kso.hitung_gpm((select v from uji.d914 where k='x'))));

-- 2. harian diisi 20.000 → default hari kerja 25 → tetap 500 rb + QC 300 rb = 800 rb → 3.000 + 888,89 + 1.111,11 = 5.000
update public.kso_bottomline_model_v set biaya_tetap_harian = 20000 where model_key = 'M-Z3';
select uji.cek('Harian 20.000 × 25 hari kerja (default) + QC → 5.000/tes',
   (select round(biaya_per_tes, 2) = 5000.00 from kso.hitung_gpm((select v from uji.d914 where k='x'))));

-- 3. hari kerja usulan 30 → tetap 600 rb + 300 rb = 900 rb → 3.000 + 1.000 + 1.111,11 = 5.111,11
update kso.rencana_kso set hari_kerja = 30 where id = (select v from uji.d914 where k='x');
select uji.cek('Hari kerja usulan 30 → biaya naik (5.111,11/tes)',
   (select round(biaya_per_tes, 2) = 5111.11 from kso.hitung_gpm((select v from uji.d914 where k='x'))));

-- 4. masa KSO usulan 60 bulan → cicilan 36 jt/(60·900) = 666,67 → 3.000 + 1.000 + 666,67 = 4.666,67
update kso.rencana_kso set tenor_bulan = 60 where id = (select v from uji.d914 where k='x');
select uji.cek('Masa KSO usulan 60 bulan → cicilan alat turun (4.666,67/tes)',
   (select round(biaya_per_tes, 2) = 4666.67 from kso.hitung_gpm((select v from uji.d914 where k='x'))));

-- 5. tes per bulan 1.800 → tetap & cicilan dibagi 2× → 3.000 + 500 + 333,33 = 3.833,33
update kso.rencana_kso set volume_estimasi = 1800 where id = (select v from uji.d914 where k='x');
select uji.cek('Tes per bulan 1.800 → biaya per tes turun (3.833,33/tes)',
   (select round(biaya_per_tes, 2) = 3833.33 from kso.hitung_gpm((select v from uji.d914 where k='x'))));

select uji.harus_gagal('Hari kerja di luar 1–31 ditolak',
   format('update kso.rencana_kso set hari_kerja = 40 where id = %s', (select v from uji.d914 where k='x')), 'check');
update public.kso_bottomline_model_v set biaya_tetap_harian = null where model_key = 'M-Z3';
