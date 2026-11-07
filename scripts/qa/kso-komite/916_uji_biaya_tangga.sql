-- Uji migrasi 284: pilihan kemasan (cartridge Blood Gas, residu terbuang) di kso.hitung_gpm. DB UJI saja, sesudah 915.
-- Tiruan 005 Z3: tetap 200 rb/bln, QC 300 rb/bln, HPP 36 jt, tenor 36. Tangga FIKTIF:
--   cartridge besar {per_tes 60, min_bulan 150.000} · cartridge kecil {per_tes 100, min_bulan 90.000}.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d916 (k text primary key, v bigint);
do $$ declare x bigint; begin
  x := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  insert into uji.d916 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;
update public.kso_bottomline_model_v
   set biaya_per_tes = 60, biaya_tangga = '[{"per_tes":60,"min_bulan":150000},{"per_tes":100,"min_bulan":90000}]'
 where model_key = 'M-Z3';

-- 1. 900 tes/bln: besar max(60, 166,67) vs kecil max(100, 100) → 100; + 500 rb/900 + 36 jt/(36·900) = 1.766,67
select uji.cek('Volume rendah → cartridge kecil, residu dihitung (1.766,67/tes)',
   (select round(biaya_per_tes, 2) = 1766.67 from kso.hitung_gpm((select v from uji.d916 where k='x'))));

-- 2. 3.000 tes/bln: besar max(60, 50) = 60 → 60 + 166,67 + 333,33 = 560
update kso.rencana_kso set volume_estimasi = 3000 where id = (select v from uji.d916 where k='x');
select uji.cek('Volume tinggi → cartridge besar tanpa residu (560/tes)',
   (select round(biaya_per_tes, 2) = 560.00 from kso.hitung_gpm((select v from uji.d916 where k='x'))));

-- 3. volume minimum zona Forum di 18.500 (S = 10.175, F = 1,5 jt): besar 162,16 · kecil 156,27 → 156,27
select uji.cek('Volume minimum Forum = pilihan kemasan terbaik (156,27)',
   (select round(volume_min_forum, 2) = 156.27 from kso.hitung_gpm((select v from uji.d916 where k='x'))));

-- 4. 2 unit, 900 tes/bln: minimum per bulan ×2 → kecil max(100, 200) = 200 + 1 jt/900 + 72 jt/(36·900) = 3.533,33
update kso.rencana_kso set volume_estimasi = 900, jumlah = 2 where id = (select v from uji.d916 where k='x');
select uji.cek('Dua unit → minimum cartridge per unit ikut dua kali (3.533,33/tes)',
   (select round(biaya_per_tes, 2) = 3533.33 from kso.hitung_gpm((select v from uji.d916 where k='x'))));

-- 5. tangga dikosongkan → rumus lama (biaya_per_tes 60): 60 + 1 jt/900 + 2.222,22 = 3.393,33
update public.kso_bottomline_model_v set biaya_tangga = null where model_key = 'M-Z3';
select uji.cek('Tanpa tangga → rumus lama tak berubah (3.393,33/tes)',
   (select round(biaya_per_tes, 2) = 3393.33 from kso.hitung_gpm((select v from uji.d916 where k='x'))));
update public.kso_bottomline_model_v set biaya_per_tes = 3000 where model_key = 'M-Z3';
