-- 264 — F145 Simulator KSO: harga beli reagen + HPP alat dari aset tetap (Pedoman Komite KSO Forum v01, Fase B)
--
-- Celah di Pedoman (27 Okt 2026): Simulator memakai harga reagen LIST/distributor dan harga alat
-- price-list (default_capex), sehingga biaya terlihat 2–4× lebih mahal dari harga beli WRG.
--
--   * kso_reagent / kso_parameter: harga_beli (per KEMASAN — satuan sama dengan harga_dp/harga_pl)
--     + accurate_item_no (kode barang Accurate) untuk saran harga dari PO terakhir. Diisi Finance
--     lewat layar (fitur kso-simulator-hargabeli). Angka TIDAK di repo (repo publik).
--   * kso_analyzer.model_key → kso_bottomline_model_v (F172): harga alat = HPP model itu (HPP standar
--     Finance, atau aset tetap cocok SN). Pemetaan awal di bawah dicocokkan per NAMA model; yang tak
--     ketemu tetap NULL dan bisa diatur dari layar.
--   * kso_harga_po_v: harga satuan PO Accurate terakhir per kode barang (cermin PO F13, migrasi 205).
--     SARAN saja — satuan PO (pcs/box) belum tentu sama dengan kemasan simulator, Finance yang memutus.
-- Simulator tetap menghitung di browser; rumus formula.ts/model.ts TIDAK berubah, hanya nilai awal.

alter table public.kso_reagent
  add column if not exists harga_beli        numeric(16,2) check (harga_beli >= 0),
  add column if not exists accurate_item_no  text,
  add column if not exists harga_beli_sumber text,
  add column if not exists harga_beli_oleh   text,
  add column if not exists harga_beli_at     timestamptz;

alter table public.kso_parameter
  add column if not exists harga_beli        numeric(16,2) check (harga_beli >= 0),
  add column if not exists accurate_item_no  text,
  add column if not exists harga_beli_sumber text,
  add column if not exists harga_beli_oleh   text,
  add column if not exists harga_beli_at     timestamptz;

alter table public.kso_analyzer
  add column if not exists model_key text;   -- = kso_bottomline_model_v.model_key (F172)

comment on column public.kso_reagent.harga_beli is 'Harga beli WRG per kemasan (satuan = harga_dp). NULL = belum diisi Finance → simulator memakai harga lama.';
comment on column public.kso_parameter.harga_beli is 'Harga beli WRG per kit (satuan = harga_dp). NULL = belum diisi Finance → simulator memakai harga lama.';
comment on column public.kso_analyzer.model_key is 'Model alat F172 (kso_bottomline_model_v) — sumber HPP alat untuk basis harga beli.';

-- pemetaan awal analyzer → model F172 (nama model populasi KSO). Hanya mengisi yang masih kosong.
update public.kso_analyzer a set model_key = m.model_key
  from (values ('Z3', 'Zybio Z3'), ('Z52', 'Zybio Z52'), ('Z50', 'Zybio Z50'),
               ('EXZ6000', 'Zybio EXZ 6000'), ('EXZ8000', 'Zybio EXZ 8000'),
               ('EXC200', 'Zybio EXC200'), ('SNIBE', 'Snibe Maglumi X3'), ('PT1000', 'Ediagnosis PT1000')) p(kode, model)
  join lateral (select v.model_key from public.kso_bottomline_model_v v where lower(v.model) = lower(p.model)
                 order by v.unit desc limit 1) m on true
 where a.kode = p.kode and a.model_key is null;

-- saran harga dari PO Accurate terakhir per kode barang
create or replace view public.kso_harga_po_v as
select distinct on (i.item_no)
       i.item_no, i.item_desc, i.unit, i.unit_price, p.po_number, p.order_date, p.vendor_name,
       count(*) over (partition by i.item_no) as jumlah_po
  from public.purchase_order_item i
  join public.purchase_order p on p.id = i.purchase_order_id
 where p.source = 'accurate' and p.cancelled_at is null
   and i.item_no is not null and i.unit_price > 0
 order by i.item_no, p.order_date desc, p.po_number desc;

comment on view public.kso_harga_po_v is 'F145 (264): harga satuan PO Accurate terakhir per kode barang — saran harga beli Simulator KSO.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select, update on public.kso_reagent, public.kso_parameter, public.kso_analyzer to wrg_app;
    grant select on public.kso_harga_po_v to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.kso_harga_po_v to wrg_readonly;
  end if;
end $$;
