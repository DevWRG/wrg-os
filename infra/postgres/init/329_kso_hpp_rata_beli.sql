-- 329 — F172: biaya reagen KSO dari HPP rata-rata PEMBELIAN 12 bulan, bukan HPP Price Book (#2382).
--
-- Keputusan user 17 Nov 2026: HPP Price Book = harga principal terbaru; untuk KSO yang dipakai HPP rata-rata
-- dari pembelian sebelumnya. Sumbernya faktur pembelian Accurate:
--   * accurate_purchase_invoice(_line) — cermin F152 (240), cakupan mulai AP_ACCURATE_SINCE (1 Okt 2026);
--   * accurate_purchase_line_riwayat (BARU) — baris faktur LEBIH TUA dari cakupan itu, diisi sinkron terpisah
--     (POST /accurate/sync/purchase-invoice-riwayat). Tabel terpisah supaya daftar 3-way match F152 tidak
--     kebanjiran faktur lama yang penerimaannya tak tercermin.
--
-- 1. harga_beli_rata_v — per kode barang Accurate, jendela 12 bulan: Σ nilai ÷ Σ qty (satuan Accurate).
--    Nilai = total baris sesudah diskon, dikurangi porsi retur. Baris tanpa harga / qty bersih ≤ 0 dibuang, juga
--    baris harga satuan ≤ Rp1 (sampel, bonus, sparepart kanibal internal — harga titipan, bukan pembelian).
-- 2. kso_reagent.beli_faktor — jumlah satuan beli Accurate per kemasan Simulator. NULL = sama dengan
--    pricebook_faktor. Perlu diisi bila satuan Price Book ≠ satuan barang Accurate (mis. Price Book per botol,
--    Accurate per set isi beberapa botol).
-- 3. kso_reagent_hpp_v — kolom `hpp` kini = rata-rata beli × faktor beli, fallback HPP Price Book; kolom baru
--    di BELAKANG (create or replace view hanya boleh menambah kolom di akhir): hpp_pb, beli_item_no,
--    beli_faktor, harga_beli_rata, beli_n_faktur, beli_dari, beli_sampai, hpp_sumber.
--    Barang dicari lewat kso_reagent.accurate_item_no (isian Finance) lalu pricebook_kode.
-- 4. kso_parameter_mix_v — `hpp` per SKU = rata-rata beli, fallback Price Book; + hpp_pb, hpp_beli, hpp_sumber.
--    Satuan sama: kit terkirim (DO) & harga beli sama-sama satuan barang Accurate.
--
-- Isian biaya yang sudah tersimpan di kso_bottomline_biaya TIDAK berubah sampai Finance menekan tombol hitung
-- ulang di tab Bottom Line. Harga beli manual Finance (kso_reagent.harga_beli) tetap menang.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

create table if not exists public.accurate_purchase_line_riwayat (
  accurate_detail_id  bigint primary key,
  invoice_id          bigint not null,
  invoice_number      text not null,
  trans_date          date not null,
  vendor_name         text,
  item_no             text,
  item_desc           text not null,
  qty                 numeric not null,
  return_qty          numeric not null default 0,
  unit_name           text,
  unit_ratio          numeric,
  unit_price          numeric,
  disc_amount         numeric not null default 0,
  total_price         numeric,
  invoice_last_update timestamptz,
  synced_at           timestamptz not null default now()
);
create index if not exists accurate_purchase_line_riwayat_item_idx on public.accurate_purchase_line_riwayat (item_no, trans_date desc);
create index if not exists accurate_purchase_line_riwayat_invoice_idx on public.accurate_purchase_line_riwayat (invoice_id);
comment on table public.accurate_purchase_line_riwayat is
  '329: baris faktur pembelian Accurate yang lebih tua dari cakupan cermin F152 — bahan HPP rata-rata beli 12 bulan (harga_beli_rata_v). Diisi POST /accurate/sync/purchase-invoice-riwayat.';

create or replace view public.harga_beli_rata_v as
with baris as (
  select l.accurate_detail_id, i.accurate_id as invoice_id, i.trans_date, l.item_no, l.qty, l.return_qty, l.unit_ratio, l.unit_price, l.total_price
    from public.accurate_purchase_invoice_line l
    join public.accurate_purchase_invoice i on i.accurate_id = l.invoice_id
  union all
  select r.accurate_detail_id, r.invoice_id, r.trans_date, r.item_no, r.qty, r.return_qty, r.unit_ratio, r.unit_price, r.total_price
    from public.accurate_purchase_line_riwayat r
   where not exists (select 1 from public.accurate_purchase_invoice_line l where l.accurate_detail_id = r.accurate_detail_id)
), bersih as (
  select item_no, invoice_id, trans_date,
         (qty - return_qty) * coalesce(nullif(unit_ratio, 0), 1) as qty_satuan,
         total_price * (qty - return_qty) / qty as nilai
    from baris
   where item_no is not null and qty > 0 and qty - return_qty > 0 and total_price is not null and total_price >= 0 and unit_price > 1
     and trans_date >= (current_date - interval '12 months')::date
)
select item_no, sum(qty_satuan) as qty, sum(nilai) as nilai,
       round(sum(nilai) / sum(qty_satuan), 2) as harga_rata,
       count(distinct invoice_id)::int as n_faktur, min(trans_date) as dari, max(trans_date) as sampai
  from bersih
 group by item_no
having sum(qty_satuan) > 0;
comment on view public.harga_beli_rata_v is
  '329: HPP rata-rata tertimbang pembelian 12 bulan per kode barang Accurate (sesudah diskon, dikurangi retur; satuan barang Accurate).';

do $do$
begin
  if to_regclass('public.kso_reagent') is null then return; end if;
  alter table public.kso_reagent add column if not exists beli_faktor numeric check (beli_faktor is null or beli_faktor > 0);
  comment on column public.kso_reagent.beli_faktor is
    '329: jumlah satuan beli Accurate per kemasan Simulator; NULL = sama dengan pricebook_faktor.';
  -- Conc Detergent kimia klinik: Price Book per jeriken 5L (faktor 4 → kemasan Simulator 4×5L), tetapi barang
  -- Accurate-nya satu SET isi 4×5L → satu satuan beli = satu kemasan Simulator.
  if to_regclass('public.kso_analyzer') is not null then
    update public.kso_reagent r set beli_faktor = 1
      from public.kso_analyzer a
     where a.id = r.analyzer_id and a.kode in ('EXC200', 'EXC400') and r.kode = 'conc' and r.beli_faktor is null;
  end if;
end $do$;

-- ---------- HPP per reagen Simulator: rata-rata beli 12 bulan → fallback Price Book ----------
do $do$
begin
  if to_regclass('public.kso_reagent') is null or to_regclass('public.product_pricelist') is null then return; end if;
  execute $v$
  create or replace view public.kso_reagent_hpp_v as
  select r.id as reagent_id, a.kode as analyzer, r.kode, r.pricebook_faktor,
         x.periode, x.row_no, x.kode as sku_kode, x.nama_final as sku_nama, x.hpp as hpp_sku,
         coalesce(round(b.harga_rata * coalesce(r.beli_faktor, r.pricebook_faktor), 2), round(x.hpp * r.pricebook_faktor, 2)) as hpp,
         round(x.hpp * r.pricebook_faktor, 2) as hpp_pb,
         coalesce(r.accurate_item_no, r.pricebook_kode) as beli_item_no,
         coalesce(r.beli_faktor, r.pricebook_faktor) as beli_faktor,
         b.harga_rata as harga_beli_rata, b.n_faktur as beli_n_faktur, b.dari as beli_dari, b.sampai as beli_sampai,
         case when b.harga_rata is not null then 'rata-rata beli 12 bln'
              when x.hpp is not null then 'Price Book' end as hpp_sumber
    from public.kso_reagent r
    join public.kso_analyzer a on a.id = r.analyzer_id
    left join lateral (
      select p.periode, p.row_no, p.kode, coalesce(s.nama_final, p.nama) as nama_final, s.hpp
        from public.product_pricelist p
        left join public.product_pricelist_setup s on s.periode = p.periode and s.row_no = p.row_no
       where (r.pricebook_kode is not null and p.kode = r.pricebook_kode)
          or (r.pricebook_kode is null and r.pricebook_nama is not null and coalesce(s.nama_final, p.nama) = r.pricebook_nama)
       order by p.periode desc, s.hpp is null, p.row_no
       limit 1) x on true
    left join public.harga_beli_rata_v b on b.item_no = coalesce(r.accurate_item_no, r.pricebook_kode)
   where r.pricebook_kode is not null or r.pricebook_nama is not null or r.accurate_item_no is not null
  $v$;
  comment on view public.kso_reagent_hpp_v is
    '329: HPP per reagen Simulator KSO = rata-rata beli 12 bulan × faktor beli; fallback HPP Price Book (periode terbaru) × faktor kemasan.';
end $do$;

-- ---------- campuran tes riil KK: HPP per SKU = rata-rata beli 12 bulan → fallback Price Book ----------
do $do$
begin
  if to_regclass('public.kso_parameter_sku') is null or to_regclass('public.accurate_delivery_order') is null
     or to_regclass('public.kso_bottomline_unit_v') is null or to_regclass('public.product_pricelist') is null then return; end if;
  execute $v$
  create or replace view public.kso_parameter_mix_v as
  with f as (
    select distinct a.kode as analyzer, u.account_id
      from public.kso_analyzer a join public.kso_bottomline_unit_v u on u.model_key = a.model_key
     where a.kategori = 'CC' and u.account_id is not null
  ), kirim as (
    select f.analyzer, i.item_no, sum(i.qty) as kit
      from f join public.accurate_delivery_order d on d.customer_id = f.account_id
      join public.accurate_delivery_order_item i on i.delivery_id = d.id
     where d.trans_date >= current_date - 365
     group by 1, 2
  )
  select a.kode as analyzer, s.parameter, s.sku_kode, p.tests_per_kit * s.faktor as tes_per_kemasan,
         coalesce(k.kit, 0) as kit_12bln, coalesce(b.harga_rata, x.hpp)::numeric(16,2) as hpp,
         x.hpp as hpp_pb, b.harga_rata as hpp_beli,
         case when b.harga_rata is not null then 'rata-rata beli 12 bln'
              when x.hpp is not null then 'Price Book' end as hpp_sumber
    from public.kso_analyzer a
    join public.kso_parameter p on p.grup = a.kategori
    join public.kso_parameter_sku s on s.grup = p.grup and s.parameter = p.nama
    left join kirim k on k.analyzer = a.kode and k.item_no = s.sku_kode
    left join lateral (
      select ps.hpp from public.product_pricelist pl
        left join public.product_pricelist_setup ps on ps.periode = pl.periode and ps.row_no = pl.row_no
       where pl.kode = s.sku_kode
       order by pl.periode desc, ps.hpp is null, pl.row_no limit 1) x on true
    left join public.harga_beli_rata_v b on b.item_no = s.sku_kode
   where a.kategori = 'CC' and a.model_key is not null
  $v$;
  comment on view public.kso_parameter_mix_v is
    '329: campuran tes riil Kimia Klinik per alat (DO 12 bulan × tes per kit) + HPP per SKU (rata-rata beli 12 bulan, fallback Price Book).';
end $do$;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select, insert, update, delete on public.accurate_purchase_line_riwayat to wrg_app;
    grant select on public.harga_beli_rata_v to wrg_app;
    if to_regclass('public.kso_reagent_hpp_v') is not null then grant select on public.kso_reagent_hpp_v to wrg_app; end if;
    if to_regclass('public.kso_parameter_mix_v') is not null then grant select on public.kso_parameter_mix_v to wrg_app; end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.accurate_purchase_line_riwayat, public.harga_beli_rata_v to wrg_readonly;
    if to_regclass('public.kso_reagent_hpp_v') is not null then grant select on public.kso_reagent_hpp_v to wrg_readonly; end if;
    if to_regclass('public.kso_parameter_mix_v') is not null then grant select on public.kso_parameter_mix_v to wrg_readonly; end if;
  end if;
end $do$;
