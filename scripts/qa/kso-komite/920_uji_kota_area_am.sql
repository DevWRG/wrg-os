-- Uji migrasi 304: kota faskes BARU tidak ditanyakan — default area AM (kso.am.cabang), boleh diganti kota dari PDF
-- Simulator / label KOTA, kota tertulis tak pernah ditimpa. DB UJI saja, sesudah 900–919. Nama & kota fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d920 (k text primary key, v text);
grant all on uji.d920 to wrg_app;

set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select set_config('wrg.kso_peran', '', false);

-- 1. tanpa KOTA → kota = area AM, ditandai default
insert into uji.d920 select 'a', kso.app_bot_buat_faskes_baru('AM-01', 'Klinik Uji Area Fiktif', null);
select uji.cek('Faskes baru tanpa KOTA → kota = area (cabang) AM pengusul, ditandai kota_dari_area',
   (select kota = (select cabang from kso.am where id = 'AM-01') and kota_dari_area
      from kso.faskes where id = (select v from uji.d920 where k = 'a')));

-- 2. kota dari PDF / label KOTA mengganti default area; sesudah itu tak ditimpa lagi
select uji.cek('Kota dari PDF Simulator / label KOTA mengganti default area AM',
   kso.app_bot_isi_kota_faskes('AM-01', (select v from uji.d920 where k = 'a'), ' Kota  Fiktif Satu '));
select uji.cek('Kota tertulis tersimpan rapi, penanda default dilepas',
   (select kota = 'Kota Fiktif Satu' and not kota_dari_area from kso.faskes where id = (select v from uji.d920 where k = 'a')));
select uji.cek('Kota tertulis tidak ditimpa',
   not kso.app_bot_isi_kota_faskes('AM-01', (select v from uji.d920 where k = 'a'), 'Kota Fiktif Dua'));

-- 3. pakai ulang nama sama: default area diganti kota tertulis; kota tertulis tak diganti area/kota lain
insert into uji.d920 select 'b', kso.app_bot_buat_faskes_baru('AM-01', 'Klinik Uji Area Fiktif Dua', null);
insert into uji.d920 select 'b2', kso.app_bot_buat_faskes_baru('AM-02', 'klinik uji area fiktif dua', 'Kota Fiktif Tiga');
select uji.cek('Nama sama + KOTA tertulis → faskes sama, default area diganti',
   (select v from uji.d920 where k = 'b2') = (select v from uji.d920 where k = 'b')
   and (select kota = 'Kota Fiktif Tiga' and not kota_dari_area from kso.faskes where id = (select v from uji.d920 where k = 'b')));
insert into uji.d920 select 'b3', kso.app_bot_buat_faskes_baru('AM-02', 'Klinik Uji Area Fiktif Dua', null);
select uji.cek('Nama sama tanpa KOTA → kota tertulis tetap',
   (select kota = 'Kota Fiktif Tiga' and not kota_dari_area from kso.faskes where id = (select v from uji.d920 where k = 'b')));
reset role;

-- 4. BUKTI VOLUME dari templat #KSO (nomor 11) → label 'data' (gerbang 2 bisa hijau)
select uji.cek('BUKTI VOLUME: rekap LIS 6 bulan / pembelian reagen / surat RS → label data',
   (select bool_and(kso.tebak_label_sumber(x) = 'data')
      from unnest(array['rekap LIS 6 bulan', 'REKAP LIS 6 BULAN', 'pembelian reagen', 'surat RS']) x));
