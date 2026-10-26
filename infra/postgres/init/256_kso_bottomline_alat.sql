-- 256 — F172 Bottom Line Alat KSO: lantai harga per tes per model alat (tab Komite KSO)
--
-- Dasar: artifact Direktur "Bottom Line Alat KSO" (snapshot 21 Okt 2026) + keputusan user 26 Okt:
-- jadi tab di Komite KSO, Direktur mengisi lewat UI WRG-OS (artifact tak dipakai lagi).
--
--   lantai/tes = biaya reagen per tes + biaya tetap per bulan ÷ volume
--              + (K × HPP) ÷ bulan ÷ volume
--
-- Pembagian kerja:
--   * view (live, baca saja)   : populasi unit, omzet 12 bln, volume historis, HPP aset tetap.
--   * tabel parameter (UI)     : K, bulan, penyangga AM — satu baris global.
--   * tabel jenis (UI/impor)   : kelompok layar + Rp/tes acuan pengganti (HD = tarif per tindakan)
--                                + margin kotor untuk taksiran biaya reagen.
--   * tabel biaya (UI/impor)   : biaya reagen per tes & biaya tetap per bulan per model.
--                                ANGKANYA TIDAK DI REPO (repo publik) — diisi skrip impor
--                                scripts/ops/impor-bottomline-biaya.mjs atau dari layar.
--   * tabel keputusan (UI)     : putusan Direktur per model + log riwayat (append-only).
-- Rumus lantai dihitung di apps/api (repo/kso-komite-bottomline.ts) supaya parameter & isian
-- Direktur langsung terlihat tanpa menyimpan angka turunan.
--
-- Beda sengaja dengan artifact:
--   * omzet faskes per jenis DIBAGI RATA ke unit sejenis di faskes itu (artifact menempelkan omzet
--     faskes utuh ke tiap unit → faskes dengan 2 alat sejenis terhitung dua kali).
--   * HPP dari aset tetap ALAT KSO yang SN-nya tertulis di deskripsi/catatan aset (fixed_asset_v
--     .kso_asset_id nol terisi di prod per 26 Okt); unit dengan >1 aset cocok → perolehan terbaru.

-- ---------- parameter global ----------
create table if not exists public.kso_bottomline_parameter (
  id            int primary key default 1 check (id = 1),
  k             numeric(6,2) not null default 3   check (k > 0),
  bulan         int          not null default 36  check (bulan > 0),
  penyangga_pct numeric(6,2) not null default 20  check (penyangga_pct >= 0),
  diubah_oleh   text,
  diubah_at     timestamptz  not null default now()
);
insert into public.kso_bottomline_parameter (id) values (1) on conflict (id) do nothing;

-- ---------- per jenis: kelompok layar + acuan Rp/tes ----------
create table if not exists public.kso_bottomline_jenis (
  jenis                   text primary key,          -- = kso_jenis_kanonik(type_alat)
  kelompok                text not null,
  satuan                  text not null default 'tes' check (satuan in ('tes','tindakan')),
  rupiah_per_tes_manual   numeric check (rupiah_per_tes_manual > 0),  -- NULL = pakai kso_jenis_ringkas_v
  margin_kotor            numeric check (margin_kotor >= 0 and margin_kotor < 1), -- taksiran biaya reagen
  diubah_oleh             text,
  diubah_at               timestamptz not null default now()
);
insert into public.kso_bottomline_jenis (jenis, kelompok, satuan) values
  ('Hematology 3Diff', 'Hematologi', 'tes'),
  ('Hematology 5Diff', 'Hematologi', 'tes'),
  ('Hematology 6Diff', 'Hematologi', 'tes'),
  ('Kimia Klinik',     'Kimia Klinik', 'tes'),
  ('Immunology',       'Imunologi', 'tes'),
  ('POCT IMMUNOLOGY',  'Imunologi', 'tes'),
  ('Elektrolite',      'Elektrolit', 'tes'),
  ('BGA',              'Blood Gas', 'tes'),
  ('Coagulasi',        'Koagulasi', 'tes'),
  ('URINALYZER',       'Urinalisa', 'tes'),
  ('LED',              'LED', 'tes'),
  ('BDRS',             'Bank Darah (BDRS)', 'tes'),
  ('POCT',             'POCT', 'tes'),
  ('POCT Clover',      'POCT', 'tes'),
  ('PCR',              'PCR', 'tes'),
  ('Hemodialisa',      'Hemodialisa', 'tindakan')
on conflict (jenis) do nothing;

-- ---------- per model: biaya reagen ----------
create table if not exists public.kso_bottomline_biaya (
  model_key           text primary key,              -- jenis || '|' || model
  biaya_per_tes       numeric not null check (biaya_per_tes >= 0),  -- reagen variabel per tes
  biaya_tetap_bulan   numeric not null default 0 check (biaya_tetap_bulan >= 0), -- kalibrasi + QC per bulan
  sumber              text,
  keyakinan           text check (keyakinan in ('High','Med','Low')),
  diubah_oleh         text,
  diubah_at           timestamptz not null default now()
);

-- ---------- per model: keputusan Direktur ----------
create table if not exists public.kso_bottomline_keputusan (
  model_key       text primary key,
  jenis           text not null,
  model           text not null,
  hpp             numeric check (hpp > 0),            -- NULL = pakai HPP aset tetap
  volume          numeric check (volume > 0),         -- NULL = pakai volume historis
  k               numeric(6,2) check (k > 0),         -- NULL = pakai parameter global
  lantai_final    numeric check (lantai_final > 0),   -- NULL = pakai hasil hitung
  lantai_hitung   numeric,                            -- hasil hitung SAAT diputus (jejak audit)
  keputusan       text check (keputusan in ('Setuju','Ubah','Tahan penempatan baru','Tarik / relokasi','Diskusikan')),
  catatan         text,
  diputus_oleh    text not null,                      -- app_user.id (dari sesi)
  diputus_at      timestamptz not null default now()
);

create table if not exists public.kso_bottomline_log (
  id          bigserial primary key,
  jenis_ubah  text not null check (jenis_ubah in ('keputusan','parameter','biaya','jenis')),
  kunci       text not null,                          -- model_key / jenis / 'global'
  isi         jsonb not null,
  oleh        text not null,
  at          timestamptz not null default now()
);
create index if not exists kso_bottomline_log_kunci on public.kso_bottomline_log (kunci, at desc);

-- ---------- view per unit ----------
create or replace view public.kso_bottomline_unit_v as
with jendela as (
  select (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '12 month')::date as dari,
         (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month')::date  as sampai
), unit as (
  select a.id as asset_id, a.account_id, a.sn_key, a.skema, a.customer_raw,
         kso_jenis_kanonik(a.type_alat) as jenis,
         coalesce(nullif(btrim(a.nama_alat), ''), '(tanpa nama)') as model,
         (select max(p.mulai) from kso_asset_penempatan p where p.asset_id = a.id and p.selesai is null) as mulai
    from kso_asset a
   where a.aktif and a.in_populasi
), rev as (
  select r.account_id, r.jenis, sum(r.revenue_netto) as omzet
    from kso_revenue_jenis_v r cross join jendela j
   where r.periode between j.dari and j.sampai
     and r.kategori in (select kategori from kso_kategori_skema)
   group by r.account_id, r.jenis
), fa as (
  select f.id, upper(coalesce(f.description, '') || ' ' || coalesce(f.notes, '')) as teks,
         coalesce(f.current_asset_cost, f.asset_cost) as biaya,
         coalesce(f.tgl_perolehan_asli, f.usage_date, f.trans_date) as tgl
    from fixed_asset_v f
   where f.fa_type_name ilike 'ALAT KSO%' and not f.disposed and coalesce(f.current_asset_cost, f.asset_cost) > 0
)
select u.asset_id, u.account_id, coalesce(c.name, u.customer_raw) as faskes, u.sn_key, u.skema,
       u.jenis, u.model, u.jenis || '|' || u.model as model_key, u.mulai,
       -- bulan aktif di jendela: alat yang baru ditempatkan tak dihitung 12 bulan
       case when u.mulai is null or u.mulai <= j.dari then 12
            else greatest(1, least(12, (extract(year from age(j.sampai, date_trunc('month', u.mulai)::date)) * 12
                                       + extract(month from age(j.sampai, date_trunc('month', u.mulai)::date)))::int + 1))
       end as bulan_aktif,
       -- omzet faskes × jenis dibagi rata ke unit sejenis di faskes itu
       case when u.account_id is null then null
            else coalesce(rev.omzet, 0) / count(*) over (partition by u.account_id, u.jenis) end as omzet_12,
       count(*) over (partition by u.account_id, u.jenis) as unit_sejenis_di_faskes,
       h.biaya as hpp_sn, h.tgl as hpp_tgl, j.dari as periode_dari, j.sampai as periode_sampai
  from unit u
  cross join jendela j
  left join accurate_customer c on c.id = u.account_id
  left join rev on rev.account_id = u.account_id and rev.jenis = u.jenis
  left join lateral (
    select fa.biaya, fa.tgl from fa
     where length(u.sn_key) >= 5 and position(upper(u.sn_key) in fa.teks) > 0
     order by fa.tgl desc nulls last, fa.id desc limit 1
  ) h on true;

comment on view public.kso_bottomline_unit_v is
  'F172: unit KSO + omzet 12 bln (dibagi rata per unit sejenis di faskes) + HPP aset tetap cocok SN (migrasi 256).';

-- ---------- view per model ----------
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
         -- idle = di faskes tapi nol omzet 12 bln; alat tanpa faskes TERPETAKAN dihitung terpisah
         count(*) filter (where account_id is not null and coalesce(omzet_12, 0) <= 0)::int as idle,
         count(*) filter (where account_id is null)::int as tanpa_faskes,
         sum(omzet_12) as omzet_12,
         percentile_cont(0.5) within group (order by omzet_bln) filter (where omzet_bln > 0) as omzet_unit_bln,
         min(periode_dari) as periode_dari, min(periode_sampai) as periode_sampai
    from u group by model_key
)
select a.model_key, coalesce(bj.kelompok, a.jenis) as kelompok, a.jenis, a.model,
       coalesce(bj.satuan, 'tes') as satuan,
       a.unit, a.idle, a.tanpa_faskes, a.omzet_12, a.omzet_unit_bln,
       -- HPP: perolehan terbaru; menyimpang >40% dari median → median (aturan artifact Direktur)
       case when h.terbaru is null then null
            when h.median > 0 and abs(h.terbaru - h.median) / h.median > 0.4 then h.median
            else h.terbaru end as hpp,
       case when h.terbaru is null then null
            when h.median > 0 and abs(h.terbaru - h.median) / h.median > 0.4 then null
            else h.tgl_terbaru end as hpp_tgl,
       h.median as hpp_median, coalesce(h.unit_ber_hpp, 0)::int as unit_ber_hpp,
       case when h.terbaru is null then 'belum tercatat'
            when h.median > 0 and abs(h.terbaru - h.median) / h.median > 0.4 then 'aset tetap (SN) — median (terbaru menyimpang >40%)'
            else 'aset tetap (SN) — perolehan terbaru' end as hpp_sumber,
       coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) as rupiah_per_tes,
       case when bj.rupiah_per_tes_manual is not null then 'manual' when rj.rupiah_per_tes is not null then 'OS' end as rupiah_per_tes_sumber,
       case when coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) > 0 and a.omzet_unit_bln > 0
            then round(a.omzet_unit_bln / coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes)) end as volume,
       -- biaya: isian per model; kalau belum ada → taksiran Rp/tes × (1 − margin kotor jenis)
       coalesce(b.biaya_per_tes,
                case when bj.margin_kotor is not null
                     then round(coalesce(bj.rupiah_per_tes_manual, rj.rupiah_per_tes) * (1 - bj.margin_kotor)) end) as biaya_per_tes,
       coalesce(b.biaya_tetap_bulan, 0) as biaya_tetap_bulan,
       case when b.model_key is not null then coalesce(b.sumber, 'isian')
            when bj.margin_kotor is not null then 'taksiran: Rp/tes × (1 − margin kotor jenis)' end as biaya_sumber,
       case when b.model_key is not null then b.keyakinan when bj.margin_kotor is not null then 'Low' end as biaya_keyakinan,
       a.periode_dari, a.periode_sampai
  from agg a
  left join hpp h on h.model_key = a.model_key
  left join public.kso_bottomline_jenis bj on bj.jenis = a.jenis
  left join kso_jenis_ringkas_v rj on rj.jenis = a.jenis
  left join public.kso_bottomline_biaya b on b.model_key = a.model_key;

comment on view public.kso_bottomline_model_v is
  'F172: satu baris per model alat KSO — unit, idle, omzet, volume historis (median), HPP, biaya reagen (migrasi 256).';

-- ---------- hak akses ----------
-- default privileges 039 sudah memberi DML ke wrg_app; ditulis eksplisit supaya DB uji/baru sama
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select, insert, update on public.kso_bottomline_parameter, public.kso_bottomline_jenis,
          public.kso_bottomline_biaya, public.kso_bottomline_keputusan to wrg_app;
    grant select, insert on public.kso_bottomline_log to wrg_app;
    grant usage, select on sequence public.kso_bottomline_log_id_seq to wrg_app;
    grant select on public.kso_bottomline_unit_v, public.kso_bottomline_model_v to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.kso_bottomline_parameter, public.kso_bottomline_jenis, public.kso_bottomline_biaya,
          public.kso_bottomline_keputusan, public.kso_bottomline_log,
          public.kso_bottomline_unit_v, public.kso_bottomline_model_v to wrg_readonly;
  end if;
end $$;
