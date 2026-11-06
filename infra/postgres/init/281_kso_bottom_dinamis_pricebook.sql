-- 281: F170 / F172 — bottom per tes DINAMIS: tes per bulan, hari kerja, masa KSO + harga reagen merujuk Price Book.
--
-- Keputusan user 6 Nov 2026: harga bottom per tes harus mengikuti faktor yang sama dengan Simulator KSO
-- (masa KSO, tes per bulan, hari kerja per bulan, margin) dan harga reagennya merujuk Price Book.
--
--   biaya/tes = reagen/tes + (reagen harian × hari kerja + QC per bulan) ÷ tes per bulan + HPP ÷ (masa KSO × tes per bulan)
--
-- * Rumus hematologi Simulator linear: konsumsi per siklus tes tetap, reagen harian (startup/shutdown/cuci) tetap
--   per hari → kso_bottomline_biaya.biaya_tetap_harian. biaya_tetap_bulan tetap dipakai bila harian kosong
--   (isian manual Finance per bulan).
-- * Hari kerja: kso_bottomline_parameter.hari_kerja (default 25) — boleh ditimpa per usulan (kso.rencana_kso.hari_kerja,
--   diisi AM lewat #KSO; tahap 2).
-- * Masa KSO: tenor usulan (kso.rencana_kso.tenor_bulan); kosong → parameter bulan (36). Sebelumnya hitung_gpm
--   SELALU memakai parameter 36.
-- * Harga reagen: public.kso_reagent ditautkan ke SKU Price Book (pricebook_kode = kode Accurate, atau
--   pricebook_nama = nama SKU bila tanpa kode) × pricebook_faktor (jumlah SKU per kemasan Simulator).
--   public.kso_reagent_hpp_v = HPP Price Book periode terbaru per reagen. Harga beli manual tetap menang.
-- Tautan 25 reagen hematologi Zybio diisi di sini — hanya kode/nama SKU, TANPA harga (repo publik).

-- ---------- parameter & kolom ----------
alter table kso.rencana_kso add column if not exists hari_kerja int check (hari_kerja between 1 and 31);
comment on column kso.rencana_kso.hari_kerja is 'Hari kerja alat per bulan di RS ini (281). Kosong = kso_bottomline_parameter.hari_kerja.';

do $$
begin
  if to_regclass('public.kso_bottomline_parameter') is not null then
    alter table public.kso_bottomline_parameter add column if not exists hari_kerja int not null default 25 check (hari_kerja between 1 and 31);
  end if;
  if to_regclass('public.kso_bottomline_biaya') is not null then
    alter table public.kso_bottomline_biaya add column if not exists biaya_tetap_harian numeric check (biaya_tetap_harian >= 0);
    comment on column public.kso_bottomline_biaya.biaya_tetap_harian is
      '281: reagen harian (startup/shutdown/cuci) per alat. Diisi tombol "Hitung ulang dari Price Book". Kosong = pakai biaya_tetap_bulan.';
  end if;
  if to_regclass('public.kso_bottomline_log') is not null then
    alter table public.kso_bottomline_log drop constraint if exists kso_bottomline_log_jenis_ubah_check;
    alter table public.kso_bottomline_log add constraint kso_bottomline_log_jenis_ubah_check
      check (jenis_ubah in ('keputusan','parameter','biaya','jenis','angka','dukungan','otomatis'));
  end if;
  if to_regclass('public.kso_reagent') is not null then
    alter table public.kso_reagent add column if not exists pricebook_kode text;
    alter table public.kso_reagent add column if not exists pricebook_nama text;
    alter table public.kso_reagent add column if not exists pricebook_faktor numeric not null default 1 check (pricebook_faktor > 0);
  end if;
end $$;

-- ---------- view model Bottom Line + biaya_tetap_harian ----------
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
       b.biaya_tetap_harian
  from agg a
  left join aset h on h.model_key = a.model_key
  left join public.kso_bottomline_jenis bj on bj.jenis = a.jenis
  left join kso_jenis_ringkas_v rj on rj.jenis = a.jenis
  left join public.kso_bottomline_biaya b on b.model_key = a.model_key$v$;
end $do$;

-- ---------- HPP Price Book per reagen Simulator ----------
do $do$
begin
  if to_regclass('public.kso_reagent') is null or to_regclass('public.product_pricelist') is null then return; end if;
  execute $v$
  create or replace view public.kso_reagent_hpp_v as
  select r.id as reagent_id, a.kode as analyzer, r.kode, r.pricebook_faktor,
         x.periode, x.row_no, x.kode as sku_kode, x.nama_final as sku_nama, x.hpp as hpp_sku,
         round(x.hpp * r.pricebook_faktor, 2) as hpp
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
   where r.pricebook_kode is not null or r.pricebook_nama is not null
  $v$;
  comment on view public.kso_reagent_hpp_v is '281: HPP Price Book (periode terbaru) × faktor kemasan per reagen Simulator KSO yang ditautkan.';
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then grant select on public.kso_reagent_hpp_v to wrg_app; end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then grant select on public.kso_reagent_hpp_v to wrg_readonly; end if;
end $do$;

-- ---------- tautan 25 reagen hematologi Zybio → SKU Price Book (tanpa harga) ----------
do $$
begin
  if to_regclass('public.kso_reagent') is null then return; end if;
  update public.kso_reagent r set pricebook_kode = t.kode, pricebook_nama = t.nama, pricebook_faktor = t.faktor
    from public.kso_analyzer a,
         (values
           ('Z3','lyse','HMG.0130',null,1), ('Z3','dil','HMG.0129',null,1), ('Z3','probe','HMG.0131',null,1),
           ('Z52','dn','HMG.0165',null,1), ('Z52','ld','HMG.0167',null,1), ('Z52','lb','HMG.0203',null,1), ('Z52','probe','HMG.0131',null,1),
           ('Z50','dn','HMG.0165',null,1), ('Z50','ld','HMG.0167',null,1), ('Z50','lb','HMG.0203',null,1), ('Z50','probe','HMG.0131',null,1),
           ('EXZ6000','dn','HMG.0165',null,1), ('EXZ6000','ldi','HMG.0168',null,1), ('EXZ6000','ldii','HMG.0170',null,1),
           ('EXZ6000','lb','HMG.0172',null,1), ('EXZ6000','probe','HMG.0131',null,1),
           ('EXZ8000','dn',null,'ZYBIO H58 DN Diluent 20L (Non-CE version)',1), ('EXZ8000','ld',null,'ZYBIO H58 LD Lyse (4L×1) (Non-CE version)',1),
           ('EXZ8000','ln',null,'ZYBIO H58 LN Lyse (4L×1) (Non-CE version)',1), ('EXZ8000','fd',null,'ZYBIO H58 FD Dye (48Ml×1) (Non-CE version)',1),
           ('EXZ8000','fn',null,'ZYBIO H58 FN Dye (48Ml×1) (Non-CE version)',1), ('EXZ8000','ls',null,'ZYBIO H58 LS Lyse (1L×1) (Non-CE version)',1),
           ('EXZ8000','dr',null,'ZYBIO H58 DR Diluent (1L×1) (Non-CE version)',1), ('EXZ8000','fr',null,'ZYBIO H58 FR Dye (12Ml×1) (Non-CE version)',1),
           ('EXZ8000','probe','HMG.0131',null,2)
         ) as t(analyzer, reagen, kode, nama, faktor)
   where a.id = r.analyzer_id and a.kode = t.analyzer and r.kode = t.reagen
     and r.pricebook_kode is null and r.pricebook_nama is null;          -- tautan yang sudah diatur di layar tak ditimpa
end $$;

-- ---------- GPM deal: hari kerja + masa KSO usulan ----------
create or replace function kso.hitung_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, model_key text,
               biaya_per_tes numeric, harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql stable as $$
declare r kso.rencana_kso; p record; m record; v_n int; v_hpp numeric; v_tetap numeric; v_biaya numeric; v_sisa numeric;
        v_hk int; v_tenor int;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into p from kso.param_gpm();
  select a.model_key as mk, b.hpp, b.biaya_per_tes as reagen, b.biaya_tetap_bulan as tetap, b.biaya_tetap_harian as harian,
         b.qc_bulan as qc, b.satuan
    into m
    from public.kso_analyzer a left join public.kso_bottomline_model_v b on b.model_key = a.model_key
   where a.kode = r.alat_kode
   order by a.model_key is null, a.id limit 1;
  model_key := m.mk; hd := coalesce(m.satuan = 'tindakan', false);
  if hd then
    zona := 'direktur'; catatan := 'Hemodialisa: Kalkulator HD — selalu Direktur'; return next; return;
  end if;
  if m.mk is null then catatan := 'Alat belum dipetakan ke model Bottom Line (Simulator → Kelola harga beli → Alat)';
  elsif m.hpp is null then catatan := 'HPP alat belum ada (Finance: HPP standar di Bottom Line Alat)';
  elsif m.reagen is null then catatan := 'Biaya reagen per tes belum ada (Bottom Line Alat → Hitung ulang dari Price Book)';
  elsif r.harga_per_test is null or r.harga_per_test <= 0 then catatan := 'Harga per tes belum diisi';
  elsif r.volume_estimasi is null or r.volume_estimasi <= 0 then catatan := 'Volume per bulan belum diisi';
  end if;
  if catatan is not null then return next; return; end if;

  v_hk := coalesce(r.hari_kerja, kso.hari_kerja_default());
  v_tenor := coalesce(nullif(r.tenor_bulan, 0), p.tenor);
  v_n := coalesce(r.jumlah, 1);
  v_hpp := m.hpp * v_n + coalesce(r.biaya_instalasi, 0);
  v_tetap := (coalesce(m.harian * v_hk, m.tetap, 0) + coalesce(m.qc, 0)) * v_n;
  v_biaya := m.reagen + v_tetap / r.volume_estimasi + v_hpp / (v_tenor * r.volume_estimasi);
  biaya_per_tes := v_biaya;
  gpm := 1 - v_biaya / r.harga_per_test;
  zona := kso.zona_dari(gpm);
  harga_am := v_biaya / (1 - p.g_am);
  harga_hod := v_biaya / (1 - p.g_hod);
  harga_forum := v_biaya / (1 - p.g_forum);
  v_sisa := r.harga_per_test * (1 - p.g_forum) - m.reagen;
  volume_min_forum := case when v_sisa > 0 then (v_tetap + v_hpp / v_tenor) / v_sisa end;
  catatan := 'GPM ' || replace(to_char(gpm * 100, 'FM990.0'), '.', ',') || '% → zona '
             || case zona when 'am' then 'AM' when 'hod' then '2 HOD' when 'forum' then 'Forum' else 'Direktur' end;
  return next;
end $$;

-- hari kerja default (plpgsql: kolom 281 cukup ada saat dipanggil; DB uji tanpa kolom → 25)
create or replace function kso.hari_kerja_default() returns int language plpgsql stable as $$
declare v int;
begin
  begin
    execute 'select hari_kerja from public.kso_bottomline_parameter where id = 1' into v;
  exception when undefined_column or undefined_table then v := null;
  end;
  return coalesce(v, 25);
end $$;

revoke execute on function kso.hari_kerja_default() from public;
