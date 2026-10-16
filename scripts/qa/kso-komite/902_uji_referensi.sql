-- Uji migrasi 228 (pengisian referensi kso.* dari tabel OS) dengan tabel OS TIRUAN berisi angka fiktif.
-- Jalankan lewat jalankan_uji.sh SETELAH 900/901, di database UJI saja.
\set ON_ERROR_STOP on
set timezone = 'UTC';

-- ---------- tiruan tabel OS (kolom yang dibaca 228 saja) ----------
create table public.area_kota (kota text primary key, cabang text);
create table public.hod_territory (hod_key text, cabang text);
create table public.master_hod (hod_key text primary key, nama text, peran text, aktif boolean);
create table public.master_user (am_id text, nama text, role text, cabang text, wa_number text, aktif boolean);
create table public.kso_analyzer (kode text, label text, kategori text, brand text, aktif boolean);
create table public.product_pricelist_setup (periode text, nama_final text, hpp numeric);
create table public.crm_account (account_id bigint primary key, owner_am_id text);
create table public.accurate_customer (id bigint primary key, name text);
create table public.ar_aging_mv (customer_id varchar, invoice_no varchar, due_date date, amount numeric);
create table public.accurate_invoice (number text, customer_id bigint, tanggal date, total numeric, outstanding numeric);
create function public.area_customer(p bigint) returns text language sql stable as $$
  select ak.cabang from public.accurate_customer c
    join public.area_kota ak on ak.kota = upper(btrim(substring(c.name from '((?:KAB\.|KOTA) [A-Za-z .\-]+)$')))
   where c.id = p $$;

insert into public.area_kota values ('KOTA MALANG','MALANG'), ('KOTA BALIKPAPAN','SBY 1');
insert into public.hod_territory values ('rocky','MALANG');
insert into public.master_hod values ('rocky','Rocky','Sales East',true), ('mufid','Mufid','Business IVD',true),
                                     ('arman','Arman','Business Medical & HD',true), ('ika','Ika','Finance & SC',true);
insert into public.master_user values ('AMX','AM Uji','AM','MALANG','0811-0000-999',true);
insert into public.kso_analyzer values ('Z3','Z3','HEMATO',null,true), ('ANEH','Aneh','HEMATO',null,true);
insert into public.product_pricelist_setup values ('H1-2026','ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3', 40000000),
                                                  ('H2-2026','ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3', 41000000);
insert into public.accurate_customer values (9001,'RS UJI, RS UJI KOTA MALANG'), (9002,'KLINIK UJI, KLINIK KOTA BALIKPAPAN');
insert into public.crm_account values (9001,'AMX'), (9002,'AMX');
insert into public.accurate_invoice values
  ('INV/1', 9001, current_date - 30, 30000000, 0),          -- sudah lunas
  ('INV/2', 9001, current_date - 50, 12000000, 5000000);    -- sisa 5 jt
insert into public.ar_aging_mv values
  ('9001','INV/1', current_date - 200, 30000000),           -- lunas: tak boleh ikut umur/nilai piutang
  ('9001','INV/2', current_date - 20,  12000000);

select kso.segarkan_referensi();
update kso.kategori set harga_standar_per_test = 18500 where kode = 'HEMATO';   -- isian C10 manual
select kso.segarkan_referensi();                                                -- jalan ulang: idempoten

select uji.cek('Cabang tanpa HOD Area (SBY 1) masuk wilayah OFFICE', (select wilayah='OFFICE' from kso.cabang where nama='SBY 1'));
select uji.cek('Cabang ber-HOD Area mengikuti peran HOD-nya', (select wilayah='Sales East' from kso.cabang where nama='MALANG'));
select uji.cek('HOD: Sales = area, Business IVD = bisnis ivd, Business lain = non_ivd, non-sales/bisnis diabaikan',
   (select string_agg(id||':'||jenis||':'||cakupan, ',' order by id) from kso.hod where id in ('rocky','mufid','arman','ika'))
   = 'arman:bisnis:non_ivd,mufid:bisnis:ivd,rocky:area:Sales East');
select uji.cek('No WA AM dinormalkan ke 62…', (select no_wa='628110000999' from kso.am where id='AMX'));
select uji.cek('Harga alat = HPP periode terbaru', (select harga_po=41000000 from kso.alat where kode='Z3'));
select uji.cek('Analyzer tanpa padanan HPP tidak dimasukkan (tak ada angka karangan)', not exists (select 1 from kso.alat where kode='ANEH'));
select uji.cek('Isian harga standar C10 tidak tertimpa refresh', (select harga_standar_per_test=18500 from kso.kategori where kode='HEMATO'));
select uji.cek('Faktur lunas tidak ikut piutang: nilai = sisa 5 jt, umur dari faktur yang masih bersisa',
   (select piutang_nilai=5000000 and piutang_hari=20 from kso.faskes where id='9001'));
select uji.cek('Tagihan bulanan = total faktur 12 bulan / 12', (select tagihan_bulanan=3500000 from kso.faskes where id='9001'));
select uji.cek('Faskes ikut cabang dari kota di nama customer', (select cabang='SBY 1' from kso.faskes where id='9002'));

do $$ declare x bigint; y bigint; begin
  -- SBY 1 (office): hanya HOD Bisnis yang ditemukan → jalur forum walau gerbang lain bisa hijau
  x := kso.buat_draft('AMX','9002','Z3',1,700,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  -- (data contoh 004 ikut punya HOD bisnis ivd 'HB-IVD', jadi yang diuji: tak ada kursi area, mufid ada)
  perform uji.cek('SBY 1: routing tanpa HOD Area, HOD Business IVD ikut',
     not exists (select 1 from kso.hod_untuk(x) where jenis = 'area') and exists (select 1 from kso.hod_untuk(x) where hod_id = 'mufid'));
  perform uji.cek('SBY 1: langsung jalur forum', kso.ajukan(x) = 'FORUM');
  -- register teknisi kosong untuk kategori ini → gerbang 3 'belum', bukan 'merah'
  y := kso.buat_draft('AMX','9001','Z3',1,700,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform uji.cek('Register teknisi kosong → gerbang 3 belum bisa dicek', substr(uji.pola(y),3,1) = 'b');
end $$;
