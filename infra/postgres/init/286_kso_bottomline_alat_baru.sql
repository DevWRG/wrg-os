-- 286: F172 × F170 — baris "alat baru" di Bottom Line (keputusan user 7 Nov 2026).
--
-- Alat di katalog #KSO yang belum punya unit terpasang (EXC400, Snibe Maglumi X3, DN-X6) tak punya baris Bottom Line,
-- sehingga usulannya tak punya GPM dan selalu jatuh ke zona Direktur. Sekarang:
--   * kso_analyzer.pricebook_kode / pricebook_nama = SKU unit alat di Price Book → HPP alat (bisa ditimpa HPP standar Finance);
--   * kso_bottomline_model_v menambah baris untuk analyzer ber-model_key yang belum punya populasi (alat_baru = true);
--   * tiga analyzer dipetakan ke model_key bila masih kosong; detergent EXC400 = SKU EXC200 (kemasan identik di master).
-- Biaya reagen: EXC400 lewat tombol Price Book (campuran tes alat sejenis); Snibe & DN-X6 diisi Finance sampai rumusnya ada.
-- Hanya kode/nama SKU di sini — TANPA harga (repo publik).

do $$
begin
  if to_regclass('public.kso_analyzer') is null then return; end if;
  alter table public.kso_analyzer add column if not exists pricebook_kode text;
  alter table public.kso_analyzer add column if not exists pricebook_nama text;
  comment on column public.kso_analyzer.pricebook_kode is '286: SKU unit alat di Price Book — HPP alat untuk baris alat baru Bottom Line.';
  update public.kso_analyzer a set
         model_key      = coalesce(a.model_key, t.model_key),
         pricebook_kode = coalesce(a.pricebook_kode, t.kode),
         pricebook_nama = coalesce(a.pricebook_nama, t.nama)
    from (values ('EXC400', 'Kimia Klinik|Zybio EXC400',        'IDS.0227', null),
                 ('SNIBE',  'Immunology|Snibe Maglumi X3',      null, 'SNIBE MAGLUMI X3 FULLY AUTOMATIC CLIA SYSTEM'),
                 ('DNX6',   'Elektrolite|Easy Diagnosis DN-X6', null, 'Easy Diagnosis DN-X6 (Na,Ka,Cl,Ca,PH,Li)')
         ) as t(kode_alat, model_key, kode, nama)
   where a.kode = t.kode_alat;
end $$;

do $$
begin
  if to_regclass('public.kso_reagent') is null then return; end if;
  update public.kso_reagent r set pricebook_kode = t.kode, pricebook_faktor = t.faktor
    from public.kso_analyzer a,
         (values ('EXC400','conc','RKK.0302',4), ('EXC400','probe_d','RKK.0303',1)) as t(analyzer, reagen, kode, faktor)
   where a.id = r.analyzer_id and a.kode = t.analyzer and r.kode = t.reagen
     and r.pricebook_kode is null and r.pricebook_nama is null;
end $$;

do $do$
begin
  if to_regclass('public.kso_bottomline_unit_v') is null then return; end if;
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
  left join kso_jenis_ringkas_v rj on rj.jenis = a.jenis
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
       and not exists (select 1 from public.kso_bottomline_unit_v u where u.model_key = an.model_key)
     order by an.model_key, an.id
  ) n
  left join public.kso_bottomline_jenis bj on bj.jenis = n.jenis
  left join kso_jenis_ringkas_v rj on rj.jenis = n.jenis
  left join public.kso_bottomline_biaya b on b.model_key = n.model_key$v$;
end $do$;

