-- 263 — F172 Bottom Line Alat: model GPM + zona (Pedoman Komite KSO Forum v01, 27 Okt 2026)
--
-- Pedoman mengganti "lantai = K × HPP" (artifact 21 Okt, migrasi 256) dengan GPM deal:
--
--   GPM = 1 − (reagen/tes + (reagen tetap + QC per bulan)/volume + HPP/(tenor × volume)) ÷ harga/tes
--
-- dan zona kewenangan: ≥ 55% AM · 50–55% dua HOD · 45–50% Forum → Direktur · < 45% Direktur.
-- Hemodialisa TIDAK memakai zona (aturan Kalkulator HD, selalu Direktur).
--
-- Perubahan:
--   * parameter: batas zona + tenor (kolom `bulan` dipakai sebagai tenor). K & penyangga tak dipakai lagi
--     (kolom dibiarkan untuk riwayat).
--   * biaya per model = "angka Finance": HPP standar, reagen per tes, reagen tetap, QC per bulan
--     (DIPISAH — QC gratis prinsipal hanya menolkan QC), harga pasar min/maks. Diubah lewat fitur
--     kso-komite-bottomline-angka (grup Finance).
--   * real bottom: kso_bottomline_dukungan — promo "beli X gratis Y", alat didukung prinsipal (HPP 0),
--     QC gratis; bertanggal. Hanya fitur kso-komite-bottomline-real yang bisa membacanya (API);
--     tidak pernah ikut respons halaman biasa, WA, atau risalah.

-- ---------- parameter zona ----------
alter table public.kso_bottomline_parameter
  add column if not exists gpm_am    numeric(5,4) not null default 0.55 check (gpm_am > 0 and gpm_am < 1),
  add column if not exists gpm_hod   numeric(5,4) not null default 0.50 check (gpm_hod > 0 and gpm_hod < 1),
  add column if not exists gpm_forum numeric(5,4) not null default 0.45 check (gpm_forum > 0 and gpm_forum < 1);
comment on column public.kso_bottomline_parameter.bulan is 'Tenor cicilan alat (bulan) di rumus GPM — Pedoman v01: 36.';
comment on column public.kso_bottomline_parameter.k is 'TIDAK DIPAKAI sejak 263 (model GPM). Dibiarkan untuk riwayat.';
comment on column public.kso_bottomline_parameter.penyangga_pct is 'TIDAK DIPAKAI sejak 263 (zona GPM menggantikan penyangga).';
do $$ begin
  alter table public.kso_bottomline_parameter add constraint kso_bottomline_zona_urut check (gpm_am > gpm_hod and gpm_hod > gpm_forum);
exception when duplicate_object then null; end $$;

-- ---------- angka Finance per model ----------
alter table public.kso_bottomline_biaya alter column biaya_per_tes drop not null;
alter table public.kso_bottomline_biaya
  add column if not exists hpp_standar     numeric check (hpp_standar > 0),        -- NULL = HPP aset tetap (view)
  add column if not exists qc_bulan        numeric not null default 0 check (qc_bulan >= 0),
  add column if not exists harga_pasar_min numeric check (harga_pasar_min > 0),
  add column if not exists harga_pasar_max numeric check (harga_pasar_max > 0);
comment on column public.kso_bottomline_biaya.biaya_tetap_bulan is 'Reagen tetap per bulan (kalibrasi, dsb.) TANPA QC — QC di qc_bulan sejak 263.';
do $$ begin
  alter table public.kso_bottomline_biaya add constraint kso_bottomline_pasar_urut
    check (harga_pasar_min is null or harga_pasar_max is null or harga_pasar_max >= harga_pasar_min);
exception when duplicate_object then null; end $$;

-- ---------- real bottom: dukungan prinsipal / promo ----------
create table if not exists public.kso_bottomline_dukungan (
  id              bigserial primary key,
  model_key       text not null,
  jenis_dukungan  text not null check (jenis_dukungan in ('promo','prinsipal','qc_gratis')),
  beli_x          int  check (beli_x > 0),       -- promo "beli X gratis Y"
  gratis_y        int  check (gratis_y > 0),
  berlaku_mulai   date not null,
  berlaku_sampai  date,                          -- NULL = sampai dicabut
  catatan         text,
  dicatat_oleh    text not null,
  dicatat_at      timestamptz not null default now(),
  dicabut_at      timestamptz,
  check (jenis_dukungan <> 'promo' or (beli_x is not null and gratis_y is not null)),
  check (berlaku_sampai is null or berlaku_sampai >= berlaku_mulai)
);
create index if not exists kso_bottomline_dukungan_model on public.kso_bottomline_dukungan (model_key) where dicabut_at is null;

-- log menerima jenis baru
alter table public.kso_bottomline_log drop constraint if exists kso_bottomline_log_jenis_ubah_check;
alter table public.kso_bottomline_log add constraint kso_bottomline_log_jenis_ubah_check
  check (jenis_ubah in ('keputusan','parameter','biaya','jenis','angka','dukungan'));

-- ---------- view per model: HPP standar Finance menang atas aset tetap, QC & harga pasar ikut ----------
-- Kolom lama dipertahankan urutannya (CREATE OR REPLACE VIEW hanya boleh menambah di ujung).
create or replace view public.kso_bottomline_model_v as
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
       h.hpp_aset
  from agg a
  left join aset h on h.model_key = a.model_key
  left join public.kso_bottomline_jenis bj on bj.jenis = a.jenis
  left join kso_jenis_ringkas_v rj on rj.jenis = a.jenis
  left join public.kso_bottomline_biaya b on b.model_key = a.model_key;

-- ---------- hak akses ----------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select, insert, update on public.kso_bottomline_dukungan to wrg_app;
    grant usage, select on sequence public.kso_bottomline_dukungan_id_seq to wrg_app;
    grant select on public.kso_bottomline_model_v to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.kso_bottomline_dukungan, public.kso_bottomline_model_v to wrg_readonly;
  end if;
end $$;
