-- Uji migrasi 280: kso_mandat_untuk_deal — mandat aktif paling ketat untuk faskes + alat sebuah deal Pipeline.
-- DB UJI saja, sesudah 900–912. Faskes uji ber-id angka (di produksi faskes_id = account_id OS).
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d913 (k text primary key, v bigint);
grant all on uji.d913 to wrg_app;
insert into kso.faskes (id, nama, cabang, grup, piutang_hari, piutang_nilai, tagihan_bulanan)
select '777001', 'RS Uji Pipeline', cabang, grup, piutang_hari, piutang_nilai, tagihan_bulanan from kso.faskes where id = 'F06'
on conflict (id) do nothing;
do $$ declare a bigint; b bigint; begin
  a := kso.buat_draft('AM-02','777001','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  b := kso.buat_draft('AM-02','777001','Z52',1,2400,'rekap LIS 6 bulan',12000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(a);
  insert into uji.d913 values ('a', a), ('b', b) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Prasyarat: usulan Z3 faskes 777001 Diputus AM, mandat berlaku',
   (select r.status = 'DIPUTUS_AM' and m.berlaku_sampai >= kso.hari_ini() from kso.rencana_kso r join kso.mandat m on m.rencana_id = r.id
     where r.id = (select v from uji.d913 where k='a')));

select uji.cek('Deal "ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3" di faskes yang sama → mandat ditemukan (nomor + batas bawah)',
   (select count(*) = 1 and min(lantai) = (select harga_lantai from kso.mandat where rencana_id = (select v from uji.d913 where k='a'))
      from public.kso_mandat_untuk_deal(777001, 'ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3')));
select uji.cek('Kode sebagai kata utuh: "Z30" tidak cocok dengan alat Z3',
   (select count(*) = 0 from public.kso_mandat_untuk_deal(777001, 'ZYBIO Z30')));
select uji.cek('Spasi huruf-angka dirapatkan: "ZYBIO Z 3" cocok dengan Z3', (select count(*) = 1 from public.kso_mandat_untuk_deal(777001, 'ZYBIO Z 3')));
select uji.cek('Faskes lain → tidak ada mandat', (select count(*) = 0 from public.kso_mandat_untuk_deal(777002, 'ZYBIO Z3')));
select uji.cek('Usulan tanpa mandat (draft Z52) → tidak ada mandat', (select count(*) = 0 from public.kso_mandat_untuk_deal(777001, 'ZYBIO Z52')));
select uji.cek('Teks kosong / account kosong → tidak ada mandat',
   (select (select count(*) from public.kso_mandat_untuk_deal(777001, '')) = 0 and (select count(*) from public.kso_mandat_untuk_deal(null, 'Z3')) = 0));
update kso.mandat set berlaku_sampai = kso.hari_ini() - 1 where rencana_id = (select v from uji.d913 where k='a');
select uji.cek('Mandat kedaluwarsa → tidak mengunci', (select count(*) = 0 from public.kso_mandat_untuk_deal(777001, 'ZYBIO Z3')));
update kso.mandat set berlaku_sampai = kso.hari_ini() + 30 where rencana_id = (select v from uji.d913 where k='a');

set role wrg_app;
select uji.cek('Aplikasi (wrg_app, tanpa peran Komite) bisa memanggil fungsi — security definer',
   (select count(*) = 1 from public.kso_mandat_untuk_deal(777001, 'Z3')));
reset role;
