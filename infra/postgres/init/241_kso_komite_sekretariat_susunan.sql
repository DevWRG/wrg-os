-- 241 — F170 Komite KSO: peran Sekretaris (tab Sekretariat) + Susunan Komite dinamis
--
-- Dasar: deck orientasi "KSO Forum" Direktur (20 Okt 2026) + keputusan user 21 Okt:
--   * Sekretaris Komite menerbitkan penawaran, MENCOCOKKAN PKS dengan putusan, dan mencatat hasil.
--     Sekretaris menyiapkan & memastikan, TIDAK menilai (tab Sekretariat tanpa tombol Usulkan).
--   * Pencatatan PKS dipindah total dari Direksi ke Sekretaris; tab Penawaran (admin_sales) tetap.
--   * PKS dicocokkan penuh — harga, volume minimum, tenor, klausul. Tidak cocok = tidak dicatat
--     ("tidak ada tanda tangan di luar keputusan").
--   * Nama orang TIDAK di kode: jabatan & pemegangnya diisi dari UI (tabel public.kso_komite_*).
--
-- Fungsi inti kso.catat_pks (225) tidak diubah — dipakai uji jalur 900/901/904. Pagar baru ada di
-- kso.cocokkan_pks; pembungkus lama kso.app_catat_pks (harga saja) DICABUT supaya tak ada jalan pintas.

set search_path = kso, public;

-- ---------- isi PKS yang dicocokkan (dasar audit & KPI) ----------
alter table kso.rencana_kso
  add column if not exists pks_tenor_bulan    int check (pks_tenor_bulan > 0),
  add column if not exists pks_volume_minimum int check (pks_volume_minimum >= 0),
  add column if not exists pks_klausul        text[];

-- p_klausul = kode klausul yang ADA di naskah PKS: perlindungan wajib WRG (mandat.klausul_wajib:
-- eskalasi_tahunan / lapor_test / denda_telat) + klausul khusus RS (kso.klausul_khusus).
create or replace function kso.cocokkan_pks(p_id bigint, p_harga_deal numeric, p_tenor int, p_volume_min int,
                                            p_klausul text[], p_oleh text default 'sekretaris')
returns void language plpgsql as $$
declare m kso.mandat; v_kurang text[]; v_dilarang text[]; v_baru text[];
begin
  select * into m from kso.mandat where rencana_id = p_id;
  if m.rencana_id is null then raise exception 'TIDAK_ADA_MANDAT' using hint = 'PKS tanpa mandat negosiasi tidak bisa dicatat.'; end if;
  if p_harga_deal is null or p_tenor is null or p_volume_min is null then
    raise exception 'PKS_TIDAK_LENGKAP' using hint = 'Harga per test, tenor, dan volume minimum di PKS wajib diisi.'; end if;
  if p_tenor > m.tenor_maks_bulan then
    raise exception 'PKS_TIDAK_COCOK: tenor % bln melebihi mandat % bln', p_tenor, m.tenor_maks_bulan; end if;
  if m.volume_minimum is not null and p_volume_min < m.volume_minimum then
    raise exception 'PKS_TIDAK_COCOK: volume minimum % di bawah mandat %', p_volume_min, m.volume_minimum; end if;
  v_kurang := array(select k from unnest(m.klausul_wajib) k where not (k = any(coalesce(p_klausul,'{}'))));
  if cardinality(v_kurang) > 0 then
    raise exception 'PKS_TIDAK_COCOK: perlindungan wajib hilang (%)', array_to_string(v_kurang, ', '); end if;
  v_dilarang := array(select k from unnest(coalesce(p_klausul,'{}')) k where k = any(m.klausul_dilarang));
  if cardinality(v_dilarang) > 0 then
    raise exception 'PKS_TIDAK_COCOK: klausul dilarang mandat (%)', array_to_string(v_dilarang, ', '); end if;
  -- klausul khusus RS yang tidak pernah diajukan = di luar keputusan
  v_baru := array(select k from unnest(coalesce(p_klausul,'{}')) k
                   where k in (select kode from kso.klausul_khusus)
                     and not exists (select 1 from kso.rencana_klausul rk where rk.rencana_id = p_id and rk.klausul_kode = k));
  if cardinality(v_baru) > 0 then
    raise exception 'PKS_TIDAK_COCOK: klausul di luar usulan (%)', array_to_string(v_baru, ', '); end if;
  -- harga ≥ lantai & mandat belum kedaluwarsa diperiksa catat_pks
  perform kso.catat_pks(p_id, p_harga_deal, p_oleh);
  update kso.rencana_kso set pks_tenor_bulan = p_tenor, pks_volume_minimum = p_volume_min,
         pks_klausul = coalesce(p_klausul,'{}') where id = p_id;
end $$;

-- ---------- pembungkus untuk aplikasi ----------
drop function if exists kso.app_catat_pks(bigint, numeric);

create or replace function kso.app_cocokkan_pks(p_id bigint, p_harga_deal numeric, p_tenor int, p_volume_min int, p_klausul text[])
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('sekretaris');
      perform kso.cocokkan_pks(p_id, p_harga_deal, p_tenor, p_volume_min, p_klausul, 'sekretaris:' || coalesce(kso.uid_saya(),'')); end $$;

create or replace function kso.app_terbitkan_penawaran(p_id bigint, p_harga numeric)
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('admin_sales','sekretaris');
      perform kso.terbitkan_penawaran(p_id, p_harga, kso.peran_saya() || ':' || coalesce(kso.uid_saya(),'')); end $$;

create or replace function kso.app_catat_kalah(p_id bigint, p_alasan text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('admin_sales','sekretaris'); perform kso.catat_kalah(p_id, p_alasan, kso.peran_saya()); end $$;

revoke execute on function kso.cocokkan_pks(bigint,numeric,int,int,text[],text) from public;
grant execute on function kso.app_cocokkan_pks(bigint,numeric,int,int,text[]),
                          kso.app_terbitkan_penawaran(bigint,numeric), kso.app_catat_kalah(bigint,text) to wrg_app;

-- ---------- antrean Sekretariat (sama dengan 231 + dua antrean di akhir) ----------
create or replace view kso.v_antrean as
-- AM: Rencana Saya (baca saja)
select 'AM · Rencana Saya'::text as antrean, v.am_id as pemilik_id, v.id as rencana_id, v.nomor, v.status::text, v.faskes_nama,
       v.alat_nama, v.capex, v.diubah_at as sejak, null::timestamptz as batas
  from kso.v_rencana v where v.status not in ('TERPASANG','KALAH','DITOLAK_HOD','DITOLAK_DIREKSI')
union all
-- HOD: Minta Putusan (jalur cepat) — memutus
select 'HOD · Minta Putusan', h.hod_id, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diajukan_at, kso.batas_putusan_hod(v.diajukan_at)
  from kso.v_rencana v cross join lateral kso.hod_untuk(v.id) h
 where v.status = 'JALUR_CEPAT'
   and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = v.id and p.hod_id = h.hod_id and p.jenis = 'putusan')
union all
-- HOD: Minta Pendapat (jalur forum) — berpendapat
select 'HOD · Minta Pendapat', h.hod_id, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, null
  from kso.v_rencana v cross join lateral kso.hod_untuk(v.id) h
 where v.status in ('JALUR_FORUM','DIAGENDAKAN')
   and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = v.id and p.hod_id = h.hod_id and p.jenis = 'pendapat')
union all
-- Komite: Agenda Forum
select 'Komite · Agenda Forum', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex, v.diubah_at, null
  from kso.v_rencana v where v.status = 'DIAGENDAKAN'
union all
-- Direksi: Putusan (termasuk yang diusulkan ditolak — Direksi tetap yang memutus)
select 'Direksi · Putusan', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib((v.diubah_at at time zone 'Asia/Jakarta')::date, '22:00')   -- 22.00 WIB, bukan jam server
  from kso.v_rencana v where v.status in ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN')
union all
-- Admin Sales: Terbitkan Penawaran — hanya yang punya mandat yang masih berlaku
select 'Admin Sales · Terbitkan Penawaran', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib(md.berlaku_sampai, '23:59')
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status in ('DIPUTUS_HOD','MANDAT_TERBIT') and md.berlaku_sampai >= kso.hari_ini()
union all
-- Komite: mandat kedaluwarsa sebelum penawaran terbit → tarik kembali ke forum
select 'Komite · Mandat Kedaluwarsa', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, null
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status in ('DIPUTUS_HOD','MANDAT_TERBIT') and md.berlaku_sampai < kso.hari_ini()
union all
-- Teknik: Jadwal Pasang
select 'Teknik · Jadwal Pasang', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex, v.diubah_at, null
  from kso.v_rencana v where v.status = 'PKS_TTD'
union all
-- Sekretariat: penawaran terbit pagi setelah putusan (antrean sama dengan Admin Sales)
select 'Sekretariat · Terbitkan Penawaran', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib(md.berlaku_sampai, '23:59')
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status in ('DIPUTUS_HOD','MANDAT_TERBIT') and md.berlaku_sampai >= kso.hari_ini()
union all
-- Sekretariat: negosiasi berjalan → cocokkan PKS sebelum tanda tangan, atau catat kalah
select 'Sekretariat · Cocokkan PKS', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib(md.berlaku_sampai, '23:59')
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status = 'PENAWARAN_TERBIT';
alter view kso.v_antrean set (security_invoker = on);

-- ---------- Susunan Komite: jabatan & pemegang, diisi dari UI ----------
-- Hanya label jabatan yang di-seed (bisa diubah/ditambah dari UI). Nama orang = baris pemegang,
-- user_id = app_user.id (tanpa FK: diperiksa API, supaya berkas ini tetap jalan di DB uji kso).
create table if not exists public.kso_komite_jabatan (
  kode       text primary key check (kode ~ '^[a-z0-9_]{2,40}$'),
  label      text not null check (btrim(label) <> ''),
  komite     text not null check (komite in ('kso_forum','product_development')),
  urut       int  not null default 100,
  aktif      boolean not null default true,
  diubah_at  timestamptz not null default now()
);
insert into public.kso_komite_jabatan (kode, label, komite, urut) values
  ('ketua_kso', 'Ketua KSO Forum', 'kso_forum', 10),
  ('sekretaris_kso', 'Sekretaris KSO Forum', 'kso_forum', 20),
  ('cadangan_sekretaris_kso', 'Cadangan Sekretaris KSO Forum', 'kso_forum', 30),
  ('ketua_pd', 'Ketua Product Development', 'product_development', 40),
  ('sekretaris_pd', 'Sekretaris Product Development', 'product_development', 50),
  ('cadangan_sekretaris_pd', 'Cadangan Sekretaris Product Development', 'product_development', 60)
on conflict (kode) do nothing;

create table if not exists public.kso_komite_pemegang (
  id            bigserial primary key,
  jabatan_kode  text not null references public.kso_komite_jabatan(kode),
  user_id       text not null,
  mulai         date not null,
  selesai       date,                       -- NULL = masih menjabat
  dicatat_oleh  text not null,              -- app_user.id pengubah (dari sesi, bukan input)
  dicatat_at    timestamptz not null default now(),
  check (selesai is null or selesai >= mulai)
);
-- satu pemegang aktif per jabatan; ganti orang = tutup baris lama + baris baru (riwayat tetap)
create unique index if not exists kso_komite_pemegang_aktif on public.kso_komite_pemegang (jabatan_kode) where selesai is null;

-- default privileges 039 sudah memberi DML ke wrg_app; ditulis eksplisit supaya DB uji/baru sama
grant select, insert, update on public.kso_komite_jabatan, public.kso_komite_pemegang to wrg_app;
grant usage, select on sequence public.kso_komite_pemegang_id_seq to wrg_app;
