-- 284: F172 × F170 — biaya reagen otomatis dari Price Book untuk KIMIA KLINIK (EXC200) dan BLOOD GAS (PT1000).
--
-- Keputusan user 7 Nov 2026:
--   * Kimia Klinik: biaya per tes = rata-rata tertimbang CAMPURAN TES RIIL — bobot tiap parameter = kit reagen yang
--     dikirim (DO Accurate, 12 bulan) ke faskes yang memakai model itu × tes per kit. Faktur KSO hanya mencatat
--     "PEMERIKSAAN", jadi kiriman reagen satu-satunya sumber campuran tes. Detergent: per tes + harian.
--   * Blood Gas: cartridge kedaluwarsa X hari sesudah dibuka → residu terbuang DIHITUNG (mode CPRR Simulator).
--     Tiap ukuran cartridge = satu pilihan {per_tes = harga ÷ kapasitas, min_bulan = harga × 30 ÷ masa pakai};
--     reagen/tes di volume V = termurah dari max(per_tes, min_bulan ÷ V). Disimpan di kso_bottomline_biaya.biaya_tangga.
--     Tanpa tangga (hematologi, KK, isian manual) = satu pilihan {biaya_per_tes, 0} → rumus lama tak berubah.
-- Tautan SKU di sini hanya kode/nama SKU dan faktor kemasan — TANPA harga (repo publik).

do $$
begin
  if to_regclass('public.kso_bottomline_biaya') is not null then
    alter table public.kso_bottomline_biaya add column if not exists biaya_tangga jsonb
      check (biaya_tangga is null or jsonb_typeof(biaya_tangga) = 'array');
    comment on column public.kso_bottomline_biaya.biaya_tangga is
      '284: pilihan kemasan [{per_tes, min_bulan}] (cartridge BG). Reagen/tes di volume V = min(max(per_tes, min_bulan ÷ V)). Kosong = biaya_per_tes.';
  end if;
end $$;

-- ---------- view model Bottom Line + biaya_tangga (isi 281 + satu kolom) ----------
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
       b.biaya_tangga
  from agg a
  left join aset h on h.model_key = a.model_key
  left join public.kso_bottomline_jenis bj on bj.jenis = a.jenis
  left join kso_jenis_ringkas_v rj on rj.jenis = a.jenis
  left join public.kso_bottomline_biaya b on b.model_key = a.model_key$v$;
end $do$;

-- ---------- tautan Price Book: detergent EXC200 & cartridge PT-10 ----------
do $$
begin
  if to_regclass('public.kso_reagent') is null then return; end if;
  update public.kso_reagent r set pricebook_kode = t.kode, pricebook_nama = t.nama, pricebook_faktor = t.faktor
    from public.kso_analyzer a,
         (values ('EXC200','conc','RKK.0302',null,4),            -- master 20 L = 4 × jeriken 5 L
                 ('EXC200','probe_d','RKK.0303',null,1),
                 ('PT1000','pt10_60',null,'Easy Diagnosis PT 10 (60T)',1),
                 ('PT1000','pt10_120',null,'Easy Diagnosis PT 10 (120T)',1),
                 ('PT1000','pt10_200',null,'Easy Diagnosis PT 10 (200T)',1)
         ) as t(analyzer, reagen, kode, nama, faktor)
   where a.id = r.analyzer_id and a.kode = t.analyzer and r.kode = t.reagen
     and r.pricebook_kode is null and r.pricebook_nama is null;
end $$;

-- ---------- SKU reagen per parameter (Kimia Klinik) ----------
do $do$
begin
  if to_regclass('public.kso_parameter') is null then return; end if;
  create table if not exists public.kso_parameter_sku (
    grup        text not null,
    parameter   text not null,                 -- = kso_parameter.nama
    sku_kode    text not null,                 -- kode Accurate = kode Price Book
    faktor      numeric not null default 1 check (faktor > 0),  -- kemasan SKU ÷ kemasan master (tes = tests_per_kit × faktor)
    primary key (grup, sku_kode)
  );
  comment on table public.kso_parameter_sku is '284: SKU reagen per parameter Simulator — bahan campuran tes riil (DO) & HPP Price Book.';
  insert into public.kso_parameter_sku (grup, parameter, sku_kode, faktor) values
    ('CC','SGOT','RKK.0299',1), ('CC','SGPT','RKK.0300',1), ('CC','ALB','RKK.0325',1), ('CC','ALP','RKK.0294',1),
    ('CC','TBIL','RKK.0314',1), ('CC','DBIL','RKK.0330',1), ('CC','TP','RKK.0328',1),  ('CC','GGT','RKK.0327',1),
    ('CC','CREA','RKK.0301',1), ('CC','CREA','RKK.0339',2), ('CC','UREA','RKK.0329',1), ('CC','UA','RKK.0296',1),
    ('CC','TC','RKK.0326',1),   ('CC','TG','RKK.0298',1),   ('CC','HDL-C','RKK.0297',1), ('CC','LDL-C','RKK.0306',1),
    ('CC','GLU','RKK.0295',1)
  on conflict (grup, sku_kode) do nothing;
end $do$;

-- campuran tes riil per alat KK: kit terkirim 12 bulan ke faskes yang memakai model alat itu × tes per kit, + HPP Price Book
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
         coalesce(k.kit, 0) as kit_12bln, x.hpp
    from public.kso_analyzer a
    join public.kso_parameter p on p.grup = a.kategori
    join public.kso_parameter_sku s on s.grup = p.grup and s.parameter = p.nama
    left join kirim k on k.analyzer = a.kode and k.item_no = s.sku_kode
    left join lateral (
      select ps.hpp from public.product_pricelist pl
        left join public.product_pricelist_setup ps on ps.periode = pl.periode and ps.row_no = pl.row_no
       where pl.kode = s.sku_kode
       order by pl.periode desc, ps.hpp is null, pl.row_no limit 1) x on true
   where a.kategori = 'CC' and a.model_key is not null
  $v$;
  comment on view public.kso_parameter_mix_v is '284: campuran tes riil Kimia Klinik per alat (DO 12 bulan × tes per kit) + HPP Price Book per SKU.';
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select on public.kso_parameter_sku, public.kso_parameter_mix_v to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.kso_parameter_sku, public.kso_parameter_mix_v to wrg_readonly;
  end if;
end $do$;

-- ---------- GPM deal: pilihan kemasan (tangga) ----------
create or replace function kso.hitung_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, model_key text,
               biaya_per_tes numeric, harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql stable as $$
declare r kso.rencana_kso; p record; m record; v_n int; v_hpp numeric; v_tetap numeric; v_biaya numeric;
        v_hk int; v_tenor int; v_tangga jsonb; v_reagen numeric; v_f numeric; v_s numeric;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into p from kso.param_gpm();
  select a.model_key as mk, b.hpp, b.biaya_per_tes as reagen, b.biaya_tetap_bulan as tetap, b.biaya_tetap_harian as harian,
         b.qc_bulan as qc, b.satuan, b.biaya_tangga as tangga
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
  -- 284: pilihan kemasan (cartridge BG): reagen/tes = termurah dari max(per tes, minimum per bulan ÷ volume per unit)
  v_tangga := case when jsonb_typeof(m.tangga) = 'array' and jsonb_array_length(m.tangga) > 0 then m.tangga
                   else jsonb_build_array(jsonb_build_object('per_tes', m.reagen, 'min_bulan', 0)) end;
  select min(greatest((x->>'per_tes')::numeric, (x->>'min_bulan')::numeric * v_n / r.volume_estimasi))
    into v_reagen from jsonb_array_elements(v_tangga) x;
  v_biaya := v_reagen + v_tetap / r.volume_estimasi + v_hpp / (v_tenor * r.volume_estimasi);
  biaya_per_tes := v_biaya;
  gpm := 1 - v_biaya / r.harga_per_test;
  zona := kso.zona_dari(gpm);
  harga_am := v_biaya / (1 - p.g_am);
  harga_hod := v_biaya / (1 - p.g_hod);
  harga_forum := v_biaya / (1 - p.g_forum);
  -- volume minimum zona Forum: per pilihan kemasan, V ≥ max(F ÷ (S − per tes), (minimum + F) ÷ S); ambil terkecil
  v_f := v_tetap + v_hpp / v_tenor;
  v_s := r.harga_per_test * (1 - p.g_forum);
  select min(greatest(v_f / (v_s - (x->>'per_tes')::numeric), ((x->>'min_bulan')::numeric * v_n + v_f) / v_s))
    into volume_min_forum
    from jsonb_array_elements(v_tangga) x where v_s > (x->>'per_tes')::numeric;
  catatan := 'GPM ' || replace(to_char(gpm * 100, 'FM990.0'), '.', ',') || '% → zona '
             || case zona when 'am' then 'AM' when 'hod' then '2 HOD' when 'forum' then 'Forum' else 'Direktur' end;
  return next;
end $$;
