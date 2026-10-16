-- 226 — F170 Komite KSO: view antrean, agenda, ringkasan, KPI AM
--
-- Sumber: Paket Komite KSO v1.0 (Direktur, 15 Okt 2026), berkas 03-database/003_view.sql, disalin
-- TANPA perubahan isi supaya tetap identik dengan implementasi rujukan yang lulus 87 uji.
-- Uji: scripts/qa/kso-komite/jalankan_uji.sh (DB sekali pakai, bukan wrg_os_dev/prod).
-- Semua objek di schema `kso`; tidak menyentuh tabel OS yang sudah ada.

-- =====================================================================
-- Komite KSO — view untuk dashboard dan antrean tiap peran
-- Refine / Metabase cukup membaca view ini; tidak perlu query sendiri.
-- =====================================================================
set search_path = kso, public;

-- ringkasan satu baris per rencana
create or replace view kso.v_rencana as
select r.id, r.nomor, r.status, r.jalur,
       r.am_id, m.nama as am_nama, r.faskes_id, f.nama as faskes_nama, coalesce(f.cabang, m.cabang) as cabang,
       c.wilayah, r.alat_kode, a.nama as alat_nama, a.kategori, r.jumlah,
       a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0) as capex,
       r.biaya_instalasi, r.unit_status, r.harga_deal, r.pecah_paket, r.alasan_forum,
       r.volume_estimasi, r.volume_sumber, r.harga_per_test, r.tenor_bulan,
       case when r.volume_estimasi * r.harga_per_test * k.kontribusi_asumsi > 0
            then round((a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0)) / (r.volume_estimasi * r.harga_per_test * k.kontribusi_asumsi), 1) end as payback_bulan,
       (select string_agg(case g.status when 'hijau' then 'h' when 'merah' then 'm' else 'b' end, '' order by g.no)
          from kso.gerbang_hasil g where g.rencana_id = r.id) as pola_gerbang,
       (select string_agg(g.no::text, ',' order by g.no) from kso.gerbang_hasil g
         where g.rencana_id = r.id and g.status <> 'hijau') as gerbang_merah,
       r.lead_asal, r.hod_peran, r.dibuat_at, r.diajukan_at, r.diubah_at
  from kso.rencana_kso r
  join kso.am m on m.id = r.am_id
  join kso.faskes f on f.id = r.faskes_id
  join kso.alat a on a.kode = r.alat_kode
  join kso.kategori k on k.kode = a.kategori
  left join kso.cabang c on c.nama = coalesce(f.cabang, m.cabang);

-- tujuh antrean — satu view, kolom `antrean` + `pemilik_id` untuk filter per akun
create or replace view kso.v_antrean as
-- AM: Rencana Saya (baca saja)
select 'AM · Rencana Saya'::text as antrean, v.am_id as pemilik_id, v.id as rencana_id, v.nomor, v.status::text, v.faskes_nama,
       v.alat_nama, v.capex, v.diubah_at as sejak, null::timestamptz as batas
  from kso.v_rencana v where v.status not in ('TERPASANG','KALAH','DITOLAK_HOD','DITOLAK_DIREKSI')
union all
-- HOD: Minta Putusan (jalur cepat) — memutus
select 'HOD · Minta Putusan', h.hod_id, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diajukan_at, v.diajukan_at + (kso.param('batas_hod_jam_cepat') || ' hours')::interval
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
  from kso.v_rencana v where v.status = 'PKS_TTD';

-- agenda per forum
create or replace view kso.v_agenda as
select fo.id as forum_id, fo.tanggal, (array['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'])[extract(isodow from fo.tanggal)::int] as hari, fo.mode,
       ai.jenis, ai.urut, v.id as rencana_id, v.nomor, v.am_nama, v.faskes_nama, v.alat_nama, v.capex,
       v.pola_gerbang, v.gerbang_merah, v.status::text,
       (select count(*) from kso.pendapat_hod p where p.rencana_id = v.id) as pendapat_hod_masuk
  from kso.forum fo
  left join kso.agenda_item ai on ai.forum_id = fo.id
  left join kso.v_rencana v on v.id = ai.rencana_id;

-- KPI per AM per kuartal — feed untuk NPK dan Incentive Simulator
create or replace view kso.v_kpi_am as
select v.am_id, v.am_nama, to_char(v.diajukan_at at time zone 'Asia/Jakarta','YYYY-"Q"Q') as periode,
       count(*)                                                     as usulan_diajukan,
       count(*) filter (where v.jalur = 'CEPAT')                    as usulan_jalur_cepat,
       count(*) filter (where v.jalur = 'FORUM')                    as usulan_forum,
       count(*) filter (where exists (select 1 from kso.riwayat_status s where s.rencana_id = v.id and s.ke = 'DITAHAN')) as usulan_pernah_ditahan,
       round(100.0 * count(*) filter (where not exists (select 1 from kso.riwayat_status s where s.rencana_id = v.id and s.ke = 'DITAHAN'))
             / nullif(count(*),0), 1)                               as kelengkapan_pertama_persen,
       sum(v.capex) filter (where v.status in ('PKS_TTD','TERPASANG')) as capex_ditempatkan,
       sum(v.capex) filter (where vb.rasio >= 0.8)                  as capex_terverifikasi,
       percentile_cont(0.5) within group (order by vb.rasio)        as akurasi_volume_median,
       round(avg(v.harga_deal / nullif(md.harga_lantai,0)) filter (where v.harga_deal is not null), 3) as realisasi_harga_rata,  -- harga di PKS ÷ lantai
       round(100.0 * count(*) filter (where r.volume_sumber_label = 'data') / nullif(count(*),0), 1) as sumber_data_persen,
       count(*) filter (where v.pecah_paket)                       as flag_pemecahan_paket
  from kso.v_rencana v
  join kso.rencana_kso r on r.id = v.id
  left join kso.verifikasi_bulan6 vb on vb.rencana_id = v.id
  left join kso.mandat md on md.rencana_id = v.id
 where v.diajukan_at is not null
 group by v.am_id, v.am_nama, to_char(v.diajukan_at at time zone 'Asia/Jakarta','YYYY-"Q"Q');

-- ringkasan kartu atas dashboard
create or replace view kso.v_ringkasan as
select count(*) filter (where status not in ('DRAFT'))                                    as total_diajukan,
       count(*) filter (where status = 'JALUR_CEPAT')                                     as menunggu_hod,
       count(*) filter (where status in ('JALUR_FORUM','DIAGENDAKAN'))                    as menunggu_forum,
       count(*) filter (where status in ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN')) as menunggu_direksi,
       count(*) filter (where status in ('DIPUTUS_HOD','MANDAT_TERBIT'))                  as siap_penawaran,
       count(*) filter (where status = 'DITAHAN')                                         as ditahan,
       count(*) filter (where jalur = 'CEPAT')                                            as total_jalur_cepat,
       count(*) filter (where jalur = 'FORUM')                                            as total_jalur_forum,
       coalesce(sum(capex) filter (where status in ('MANDAT_TERBIT','DIPUTUS_HOD','PENAWARAN_TERBIT','PKS_TTD','TERPASANG')),0) as capex_disetujui
  from kso.v_rencana;
