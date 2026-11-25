-- 341 — F170/F172: Bottom Line Alat & Tinjauan Portofolio lambat (laporan user 25 Nov 2026).
--
-- Ukuran di prod (25 Nov, baca saja): kso_revenue_jenis_v ±0,8 dtk, kso_bottomline_unit_v 1,1 dtk,
-- kso_jenis_ringkas_v 0,8 dtk, kso_bottomline_model_v 2,9 dtk, kso_portofolio_unit_v 2,0 dtk → tab Bottom Line ±3 dtk
-- saat dibuka + ±3 dtk tiap model dibuka (/real), Tinjauan Portofolio ±3 dtk.
--
-- Akar bersama: kso_revenue_jenis_v mengalokasikan omzet SELURUH faktur sepanjang masa (window per faktur + GROUP BY)
-- sebelum disaring ke 12/24 bulan — filter periode tak bisa masuk. model_v menghitungnya ±4× (unit_v 2× + ringkas 2×).
--
-- Perbaikan:
--   1. Snapshot kso_revenue_jenis_mv (pola 187/188): omzet per faskes × bulan × jenis × kategori. Diagregasi (SUM) karena
--      keluaran view bisa kembar (cabang jenis gabungan vs langsung) — semua pembacanya menjumlahkan, hasil identik.
--      Disegarkan di kso_refresh_snapshots() = akhir tiap sinkron Accurate (scheduler) + sesudah pindah alat
--      (kso-penempatan). Sumber faktur hanya berubah lewat sinkron itu.
--   2. kso_bottomline_unit_v & kso_jenis_ringkas_v membaca snapshot — DITAMBAL dari definisi aktif (pg_get_viewdef),
--      hanya nama sumbernya yang diganti.
--   3. kso_bottomline_model_v (isi 286): ringkas jenis dihitung sekali (CTE rj), cabang "alat baru" memeriksa unit lewat
--      CTE agg alih-alih membangun unit_v kedua kalinya.
--   4. kso_portofolio_unit_v (isi 277): 4 subquery omzet berkorelasi per unit → satu CTE per faskes × jenis.
-- Isian Bottom Line (biaya, HPP standar, jenis, keputusan) TIDAK masuk snapshot → tetap langsung terlihat.
-- Kolom & tipe keluaran semua view tidak berubah (CREATE OR REPLACE). Dicek di prod 25 Nov (transaksi + ROLLBACK): 0 beda
-- (60 model, 500 unit); model_v 2,9 → 0,35 dtk, Portofolio 2,0 → 0,4 dtk. Cek ulang:
-- scripts/qa/kso-komite/cek_snapshot_bottomline.sql (menjalankan berkas ini dalam transaksi lalu ROLLBACK).

set search_path = public;

do $do$
declare v_def text;
begin
  if to_regclass('public.kso_revenue_jenis_v') is null or to_regclass('public.kso_bottomline_unit_v') is null then return; end if;

  -- ---------- 1. snapshot omzet per jenis ----------
  if to_regclass('public.kso_revenue_jenis_mv') is null then
    execute $v$create materialized view public.kso_revenue_jenis_mv as
      select r.account_id, r.periode, r.jenis, r.kategori, sum(r.revenue_netto) as revenue_netto
        from public.kso_revenue_jenis_v r
       group by r.account_id, r.periode, r.jenis, r.kategori$v$;
    -- kunci unik = syarat REFRESH … CONCURRENTLY (pembacaan tak terkunci saat disegarkan)
    execute 'create unique index kso_revenue_jenis_mv_key_idx on public.kso_revenue_jenis_mv (account_id, periode, jenis, kategori)';
    execute 'create index kso_revenue_jenis_mv_periode_idx on public.kso_revenue_jenis_mv (periode)';
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    execute 'grant select on public.kso_revenue_jenis_mv to wrg_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    execute 'grant select on public.kso_revenue_jenis_mv to wrg_readonly';
  end if;

  -- ---------- 2. unit_v & ringkas jenis membaca snapshot (tambal definisi aktif) ----------
  v_def := pg_get_viewdef('public.kso_bottomline_unit_v'::regclass);
  if position('kso_revenue_jenis_mv' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, 'kso_revenue_jenis_v', ''))) / length('kso_revenue_jenis_v') <> 1 then
      raise exception 'kso_bottomline_unit_v: rujukan kso_revenue_jenis_v bukan tepat satu — periksa sebelum menambal';
    end if;
    execute 'create or replace view public.kso_bottomline_unit_v as ' || replace(v_def, 'kso_revenue_jenis_v', 'kso_revenue_jenis_mv');
  end if;
  v_def := pg_get_viewdef('public.kso_jenis_ringkas_v'::regclass);
  if position('kso_revenue_jenis_mv' in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, 'kso_revenue_jenis_v', ''))) / length('kso_revenue_jenis_v') <> 1 then
      raise exception 'kso_jenis_ringkas_v: rujukan kso_revenue_jenis_v bukan tepat satu — periksa sebelum menambal';
    end if;
    execute 'create or replace view public.kso_jenis_ringkas_v as ' || replace(v_def, 'kso_revenue_jenis_v', 'kso_revenue_jenis_mv');
  end if;

  -- ---------- 3. model_v: unit_v & ringkas jenis masing-masing sekali ----------
  execute $v$create or replace view public.kso_bottomline_model_v as
with u as (
  select x.*, case when x.omzet_12 > 0 then x.omzet_12 / x.bulan_aktif end as omzet_bln
    from public.kso_bottomline_unit_v x
), hpp as (
  select model_key,
         (array_agg(hpp_sn order by hpp_tgl desc nulls last) filter (where hpp_sn is not null))[1] as terbaru,
         (array_agg(hpp_tgl order by hpp_tgl desc nulls last) filter (where hpp_sn is not null))[1] as tgl_terbaru,
         percentile_cont(0.5) within group (order by hpp_sn) filter (where hpp_sn is not null) as median,
         count(hpp_sn) as unit_ber_hpp
    from u group by model_key
), agg as (
  select model_key, min(jenis) as jenis, min(model) as model,
         count(*)::int as unit,
         count(*) filter (where account_id is not null and coalesce(omzet_12, 0) <= 0)::int as idle,
         count(*) filter (where account_id is null)::int as tanpa_faskes,
         sum(omzet_12) as omzet_12,
         percentile_cont(0.5) within group (order by omzet_bln) filter (where omzet_bln > 0) as omzet_unit_bln,
         min(periode_dari) as periode_dari, min(periode_sampai) as periode_sampai
    from u group by model_key
), rj as (
  -- 341: acuan Rp/tes per jenis dihitung SEKALI (dipakai dua cabang union; sebelumnya 2×)
  select * from public.kso_jenis_ringkas_v
), aset as (
  select h.*,
         case when h.terbaru is null then null
              when h.median > 0 and abs(h.terbaru - h.median) / h.median > 0.4 then h.median
              else h.terbaru end as hpp_aset,
         h.median > 0 and h.terbaru is not null and abs(h.terbaru - h.median) / h.median > 0.4 as pakai_median
    from hpp h
)
select a.model_key, coalesce(bj.kelompok, a.jenis) as kelompok, a.jenis, a.model,
       coalesce(bj.satuan, 'tes') as satuan,
       a.unit, a.idle, a.tanpa_faskes, a.omzet_12, a.omzet_unit_bln,
       coalesce(b.hpp_standar, h.hpp_aset) as hpp,
       case when b.hpp_standar is not null then null when h.pakai_median then null else h.tgl_terbaru end as hpp_tgl,
       h.median as hpp_median, coalesce(h.unit_ber_hpp, 0)::int as unit_ber_hpp,
       case when b.hpp_standar is not null then 'HPP standar Finance'
            when h.terbaru is null then 'belum tercatat'
            when h.pakai_median then 'aset tetap (SN) — median (terbaru menyimpang >40%)'
            else 'aset tetap (SN) — perolehan terbaru' end as hpp_sumber,
       coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) as rupiah_per_tes,
       case when bj.rupiah_per_tes_manual is not null then 'manual' when rj.rupiah_per_tes is not null then 'OS' end as rupiah_per_tes_sumber,
       case when coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) > 0 and a.omzet_unit_bln > 0
            then round(a.omzet_unit_bln / coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes)) end as volume,
       coalesce(b.biaya_per_tes,
                case when bj.margin_kotor is not null
                     then round(coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) * (1 - bj.margin_kotor)) end) as biaya_per_tes,
       coalesce(b.biaya_tetap_bulan, 0) as biaya_tetap_bulan,
       case when b.biaya_per_tes is not null then coalesce(b.sumber, 'isian')
            when bj.margin_kotor is not null then 'taksiran: Rp/tes × (1 − margin kotor jenis)' end as biaya_sumber,
       case when b.biaya_per_tes is not null then b.keyakinan when bj.margin_kotor is not null then 'Low' end as biaya_keyakinan,
       a.periode_dari, a.periode_sampai,
       -- kolom baru 263
       coalesce(b.qc_bulan, 0) as qc_bulan,
       b.harga_pasar_min, b.harga_pasar_max,
       h.hpp_aset,
       -- kolom baru 281
       b.biaya_tetap_harian,
       -- kolom baru 284
       b.biaya_tangga,
       -- kolom baru 286
       false as alat_baru
  from agg a
  left join aset h on h.model_key = a.model_key
  left join public.kso_bottomline_jenis bj on bj.jenis = a.jenis
  left join rj on rj.jenis = a.jenis
  left join public.kso_bottomline_biaya b on b.model_key = a.model_key
union all
-- 286: alat katalog Simulator yang belum punya unit terpasang — baris "alat baru" supaya usulan #KSO tetap punya GPM.
-- HPP alat = HPP standar Finance, kalau kosong HPP Price Book unit alat (kso_analyzer.pricebook_kode/nama).
select n.model_key, coalesce(bj.kelompok, n.jenis) as kelompok, n.jenis, n.model,
       coalesce(bj.satuan, 'tes') as satuan,
       0, 0, 0, null::numeric, null::double precision,
       coalesce(b.hpp_standar, n.hpp_pb) as hpp,
       null::date as hpp_tgl, null::double precision as hpp_median, 0,
       case when b.hpp_standar is not null then 'HPP standar Finance'
            when n.hpp_pb is not null then 'HPP Price Book unit alat (alat baru)'
            else 'belum tercatat' end as hpp_sumber,
       coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) as rupiah_per_tes,
       case when bj.rupiah_per_tes_manual is not null then 'manual' when rj.rupiah_per_tes is not null then 'OS' end as rupiah_per_tes_sumber,
       null::numeric as volume,
       b.biaya_per_tes,
       coalesce(b.biaya_tetap_bulan, 0) as biaya_tetap_bulan,
       case when b.biaya_per_tes is not null then coalesce(b.sumber, 'isian') end as biaya_sumber,
       case when b.biaya_per_tes is not null then b.keyakinan end as biaya_keyakinan,
       null::date, null::date,
       coalesce(b.qc_bulan, 0) as qc_bulan,
       b.harga_pasar_min, b.harga_pasar_max,
       null::numeric as hpp_aset,
       b.biaya_tetap_harian,
       b.biaya_tangga,
       true as alat_baru
  from (
    select distinct on (an.model_key) an.model_key,
           split_part(an.model_key, '|', 1) as jenis, split_part(an.model_key, '|', 2) as model, x.hpp as hpp_pb
      from public.kso_analyzer an
      left join lateral (
        select ps.hpp from public.product_pricelist pl
          left join public.product_pricelist_setup ps on ps.periode = pl.periode and ps.row_no = pl.row_no
         where (an.pricebook_kode is not null and pl.kode = an.pricebook_kode)
            or (an.pricebook_kode is null and an.pricebook_nama is not null and coalesce(ps.nama_final, pl.nama) = an.pricebook_nama)
         order by pl.periode desc, ps.hpp is null, pl.row_no limit 1) x on true
     where an.model_key is not null and position('|' in an.model_key) > 0
       and not exists (select 1 from agg x where x.model_key = an.model_key)  -- 341: agg = model ber-unit (sebelumnya unit_v kedua)
     order by an.model_key, an.id
  ) n
  left join public.kso_bottomline_jenis bj on bj.jenis = n.jenis
  left join rj on rj.jenis = n.jenis
  left join public.kso_bottomline_biaya b on b.model_key = n.model_key$v$;

  -- ---------- 4. Portofolio: omzet tiga bulan lewat satu join ----------
  if to_regclass('public.kso_portofolio_unit_v') is not null then
    execute $v$create or replace view public.kso_portofolio_unit_v as
with b as (
  select date_trunc('month', now() at time zone 'Asia/Jakarta')::date as bln_ini
), bulanan as (
  select r.account_id, r.jenis, r.periode, sum(r.revenue_netto) as omzet
    from public.kso_revenue_jenis_mv r cross join b  -- 341: snapshot, bukan view (alokasi seluruh faktur ±0,8 dtk)
   where r.kategori in (select k.kategori from public.kso_kategori_skema k)
     and r.periode >= (b.bln_ini - interval '24 month')::date
   group by r.account_id, r.jenis, r.periode
), per as (
  -- 341: satu baris per faskes × jenis (sebelumnya 4 subquery berkorelasi per unit atas CTE tanpa indeks).
  -- bulanan unik per (account_id, jenis, periode) → sum … filter = nilai bulan itu, NULL bila tak ada.
  select o.account_id, o.jenis,
         sum(o.omzet) filter (where o.periode = (b.bln_ini - interval '1 month')::date) as o1,
         sum(o.omzet) filter (where o.periode = (b.bln_ini - interval '2 month')::date) as o2,
         sum(o.omzet) filter (where o.periode = (b.bln_ini - interval '3 month')::date) as o3,
         max(o.periode) filter (where o.omzet > 0) as terakhir
    from bulanan o cross join b
   group by o.account_id, o.jenis
)
select u.asset_id, u.account_id, u.faskes, u.sn_key, u.skema, u.jenis, u.model, u.model_key, u.mulai,
       u.unit_sejenis_di_faskes,
       case when u.account_id is not null then public.area_customer(u.account_id) end as cabang,
       (select mu.nama from public.crm_account ca join public.master_user mu on mu.am_id = ca.owner_am_id
         where ca.account_id = u.account_id limit 1) as am_nama,
       (b.bln_ini - interval '1 month')::date as bulan_1,
       (b.bln_ini - interval '2 month')::date as bulan_2,
       (b.bln_ini - interval '3 month')::date as bulan_3,
       case when u.account_id is not null then coalesce(per.o1, 0) / u.unit_sejenis_di_faskes end as omzet_1,
       case when u.account_id is not null then coalesce(per.o2, 0) / u.unit_sejenis_di_faskes end as omzet_2,
       case when u.account_id is not null then coalesce(per.o3, 0) / u.unit_sejenis_di_faskes end as omzet_3,
       per.terakhir as omzet_terakhir,
       ar.hari as piutang_hari, ar.nilai as piutang_nilai
  from public.kso_bottomline_unit_v u
  cross join b
  left join per on per.account_id = u.account_id and per.jenis = u.jenis
  left join lateral (
    select max(greatest(current_date - m.due_date, 0)) as hari, sum(coalesce(ai.outstanding, m.amount)) as nilai
      from public.ar_aging_mv m
      left join public.accurate_invoice ai on ai.number = m.invoice_no
     where u.account_id is not null and m.customer_id = u.account_id::text and coalesce(ai.outstanding, m.amount) > 0
  ) ar on true$v$;
  end if;
end $do$;

-- ---------- refresh: snapshot baru ikut disegarkan (isi 188 + satu baris) ----------
create or replace function kso_refresh_snapshots() returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Urutan mengikat: kso_asset_produktivitas_v membaca kso_customer_revenue_mv,
  -- jadi revenue harus segar lebih dulu. Terbalik = snapshot atas dibangun dari
  -- revenue lama, salah tanpa satu pun error muncul.
  refresh materialized view concurrently kso_customer_revenue_mv;
  refresh materialized view concurrently kso_asset_produktivitas_mv;
  -- 341: omzet per jenis untuk Bottom Line Alat / Tinjauan Portofolio / Komite KSO (tak bergantung dua di atas)
  if to_regclass('public.kso_revenue_jenis_mv') is not null then
    refresh materialized view concurrently kso_revenue_jenis_mv;
  end if;
end
$fn$;
revoke all on function kso_refresh_snapshots() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant execute on function kso_refresh_snapshots() to wrg_app;
  end if;
end $$;
