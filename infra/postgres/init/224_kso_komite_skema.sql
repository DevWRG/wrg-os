-- 224 — F170 Komite KSO: skema inti (tabel, enum, transisi status)
--
-- Sumber: Paket Komite KSO v1.0 (Direktur, 15 Okt 2026), berkas 03-database/001_skema.sql, disalin
-- TANPA perubahan isi supaya tetap identik dengan implementasi rujukan yang lulus 87 uji.
-- Uji: scripts/qa/kso-komite/jalankan_uji.sh (DB sekali pakai, bukan wrg_os_dev/prod).
-- Semua objek di schema `kso`; tidak menyentuh tabel OS yang sudah ada.

-- =====================================================================
-- Komite KSO — skema inti
-- Target: PostgreSQL 15+ / Supabase. Semua objek di schema `kso`.
-- Versi 1.0 · 15 Oktober 2026
-- =====================================================================
create schema if not exists kso;
set search_path = kso, public;

-- ---------- enum ----------
create type kso.status_rencana as enum (
  'DRAFT','DIAJUKAN','JALUR_CEPAT','JALUR_FORUM','DIAGENDAKAN',
  'DITAHAN','DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN',
  'DIPUTUS_HOD','DITOLAK_HOD','MANDAT_TERBIT','DITOLAK_DIREKSI',
  'PENAWARAN_TERBIT','PKS_TTD','TERPASANG','KALAH');
create type kso.jalur          as enum ('CEPAT','FORUM');
create type kso.unit_status    as enum ('baru','eks_kso','eks_demo','refurbish','pinjaman_principal','idle');
create type kso.pendukung_tipe as enum ('manajemen','dokter_user','kepala_instalasi','analis_perawat','pengadaan');
create type kso.kontak_cara    as enum ('kunjungan','telepon','wa','email');
create type kso.lead_asal      as enum ('am','hod','direksi','principal','asosiasi','inbound');
create type kso.hod_peran      as enum ('menilai_saja','ikut_kunjungan','membuka_lead','menutup_deal');
create type kso.hod_jenis      as enum ('bisnis','area');
create type kso.gerbang_status as enum ('hijau','merah','belum');
create type kso.usulan_komite  as enum ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','DITAHAN','TIDAK_DIREKOMENDASIKAN');
create type kso.putusan_direksi as enum ('SETUJU','BERSYARAT','TOLAK');
create type kso.label_sumber   as enum ('data','lisan','belum_ada');

-- ---------- parameter: ambang ada di data, bukan di kode ----------
create table kso.parameter (
  kunci   text primary key,
  nilai   numeric not null,
  catatan text
);

-- ---------- referensi ----------
create table kso.kategori (
  kode                    text primary key,
  label                   text not null,
  harga_standar_per_test  numeric,          -- NULL = belum ada di OS → gerbang 2 'belum'
  kontribusi_asumsi       numeric           -- dipakai payback kasar; ganti dengan margin C10
);
create table kso.alat (
  kode      text primary key,
  nama      text not null,
  kategori  text not null references kso.kategori(kode),
  harga_po  numeric not null                -- harga PO aktual, bukan daftar harga
);
create table kso.cabang (
  nama     text primary key,
  wilayah  text not null                    -- dipakai routing HOD Area
);
create table kso.cabang_teknisi (           -- register sertifikasi teknisi, diringkas per kategori
  cabang    text references kso.cabang(nama),
  kategori  text references kso.kategori(kode),
  jumlah    int not null default 1 check (jumlah > 0),
  primary key (cabang, kategori)
);
-- grup mitra: dasar aturan SK Pasal 14 (grup rating 4–5 dibekukan) dan Pasal 16 (grup tanpa PKS lengkap)
create table kso.grup_mitra (
  grup             text primary key,
  rating_terburuk  int check (rating_terburuk between 1 and 5),   -- rating terburuk KSO berjalan di grup ini
  pks_lengkap      boolean                                       -- semua KSO berjalan di grup ini punya PKS bertanda tangan
);
create table kso.faskes (
  id               text primary key,
  nama             text not null,
  cabang           text references kso.cabang(nama),   -- NULL = di luar coverage
  grup             text references kso.grup_mitra(grup),
  -- tiga kolom di bawah idealnya VIEW dari AR aging; di sini kolom supaya bisa diuji
  piutang_hari     int,
  piutang_nilai    numeric,
  tagihan_bulanan  numeric
);
create table kso.klausul_khusus (
  kode   text primary key,
  label  text not null,
  urut   int not null
);
create table kso.am (
  id      text primary key,
  nama    text not null,
  cabang  text references kso.cabang(nama),
  no_wa   text unique not null               -- identifikasi pengirim WhatsApp
);
create table kso.hod (
  id      text primary key,
  nama    text not null,
  jenis   kso.hod_jenis not null,
  cakupan text not null                      -- bisnis: 'ivd'/'non_ivd' · area: nama wilayah
);
alter table kso.kategori add column lini text not null default 'ivd';   -- ivd / non_ivd → routing HOD Bisnis

-- ---------- rencana KSO ----------
create table kso.rencana_kso (
  id                        bigserial primary key,
  nomor                     text unique,
  am_id                     text not null references kso.am(id),
  faskes_id                 text not null references kso.faskes(id),
  alat_kode                 text not null references kso.alat(kode),
  jumlah                    int  not null default 1 check (jumlah > 0),
  volume_estimasi           int  check (volume_estimasi >= 0),
  volume_sumber             text,                          -- disimpan MENTAH, tidak dinormalkan
  volume_sumber_label       kso.label_sumber,              -- turunan AI, boleh dikoreksi HOD
  harga_per_test            numeric check (harga_per_test >= 0),
  unit_status               kso.unit_status,                 -- diisi OS dari master aset; NULL → gerbang 4 'belum'
  biaya_instalasi           numeric check (biaya_instalasi >= 0),  -- ikut dihitung di gerbang 1; NULL = belum diketahui
  tenor_bulan               int check (tenor_bulan > 0),
  kompetitor_alat           text,
  kompetitor_kontrak_habis  date,
  risiko_catatan            text,
  lead_asal                 kso.lead_asal,
  hod_terlibat              boolean,
  hod_peran                 kso.hod_peran,
  harga_deal                numeric,                         -- harga per test di PKS; dasar KPI realisasi harga
  nomor_seri                text,                            -- dicatat Teknik saat serah terima (SK Pasal 7 angka 4)
  pecah_paket               boolean not null default false,  -- diisi mesin gerbang (aturan anti-pemecahan)
  alasan_forum              text,                            -- alasan di luar 7 gerbang yang memaksa jalur forum
  status                    kso.status_rencana not null default 'DRAFT',
  jalur                     kso.jalur,
  wa_thread_id              text,
  dibuat_at                 timestamptz not null default now(),
  diajukan_at               timestamptz,
  diubah_at                 timestamptz not null default now()
);
create index on kso.rencana_kso (status);
create index on kso.rencana_kso (am_id, faskes_id, diajukan_at);

create table kso.rencana_klausul (
  rencana_id    bigint references kso.rencana_kso(id) on delete cascade,
  klausul_kode  text   references kso.klausul_khusus(kode),
  primary key (rencana_id, klausul_kode)
);
create table kso.rencana_pendukung (
  id                       bigserial primary key,
  rencana_id               bigint not null references kso.rencana_kso(id) on delete cascade,
  nama                     text not null,
  tipe                     kso.pendukung_tipe not null,
  sip_faskes               text[],
  kontak_terakhir_tanggal  date,
  kontak_terakhir_cara     kso.kontak_cara
);
create table kso.klaim_pembagian (
  rencana_id  bigint references kso.rencana_kso(id) on delete cascade,
  user_id     text not null,
  persen      numeric not null check (persen > 0 and persen <= 100),
  primary key (rencana_id, user_id)
);

-- ---------- hasil mesin gerbang ----------
create table kso.gerbang_hasil (
  rencana_id  bigint references kso.rencana_kso(id) on delete cascade,
  no          int check (no between 1 and 7),
  nama        text not null,
  status      kso.gerbang_status not null,
  nilai       text,
  dihitung_at timestamptz not null default now(),
  primary key (rencana_id, no)
);

-- ---------- HOD ----------
create table kso.pendapat_hod (
  rencana_id  bigint references kso.rencana_kso(id) on delete cascade,
  hod_id      text references kso.hod(id),
  jenis       text not null check (jenis in ('putusan','pendapat')),  -- dua tab, dua kata kerja
  keputusan   text check (keputusan in ('setuju','tolak','naikkan')),  -- hanya untuk jenis 'putusan'
  catatan     text,
  dianggap_setuju boolean not null default false,                      -- lewat batas waktu jalur cepat
  at          timestamptz not null default now(),
  primary key (rencana_id, hod_id, jenis),                              -- putusan dan pendapat tersimpan terpisah
  check ((jenis = 'putusan' and keputusan is not null) or (jenis = 'pendapat' and keputusan is null))
);

-- ---------- forum ----------
create table kso.forum (
  id       bigserial primary key,
  tanggal  date not null unique,
  mode     text not null default 'agenda' check (mode in ('agenda','portofolio')),
  diterbitkan_at timestamptz not null default clock_timestamp()   -- batas air Agenda B forum berikutnya
);
create table kso.agenda_item (
  forum_id    bigint references kso.forum(id) on delete cascade,
  rencana_id  bigint references kso.rencana_kso(id),
  jenis       char(1) not null check (jenis in ('A','B')),
  urut        int not null,
  primary key (forum_id, rencana_id)
);
create table kso.usulan_komite_catatan (
  rencana_id       bigint references kso.rencana_kso(id) on delete cascade,
  forum_id         bigint references kso.forum(id),
  usulan           kso.usulan_komite not null,
  syarat           jsonb,          -- [{"isi":"…","tipe":"masuk_pks|sebelum_penawaran|dipantau"}]
  mandat_usulan    jsonb,          -- usulan batas negosiasi dari komite: {"lantai":…,"target":…,"capex_maks":…,"volume_min":…,"tenor_maks":…}
  data_kurang      text,
  pemilik          text,
  tanggal_kembali  date,
  alasan           text,
  at               timestamptz not null default now(),
  primary key (rencana_id, forum_id),
  -- DITAHAN tanpa tiga kolom tidak bisa disimpan
  check (usulan <> 'DITAHAN' or (data_kurang is not null and pemilik is not null and tanggal_kembali is not null)),
  check (usulan <> 'TIDAK_DIREKOMENDASIKAN' or alasan is not null),
  check (usulan <> 'DIREKOMENDASIKAN_BERSYARAT' or syarat is not null)
);
create table kso.putusan_direksi_catatan (
  rencana_id  bigint primary key references kso.rencana_kso(id) on delete cascade,
  putusan     kso.putusan_direksi not null,
  catatan     text,
  at          timestamptz not null default now()
);

-- ---------- mandat negosiasi ----------
create table kso.mandat (
  rencana_id         bigint primary key references kso.rencana_kso(id) on delete cascade,
  harga_lantai       numeric not null,    -- bottom line: di bawah ini pipeline terkunci
  harga_target       numeric,
  tenor_maks_bulan   int not null,
  capex_maks         numeric not null,
  volume_minimum     int,                 -- di bawah ini kembali ke forum walau harga aman
  klausul_dilarang   text[] not null default '{}',
  klausul_wajib      text[] not null default '{eskalasi_tahunan,lapor_test,denda_telat}',
  berlaku_sampai     date not null,
  sumber             text not null check (sumber in ('otomatis','direksi')),
  terbit_at          timestamptz not null default now()
);

-- ---------- verifikasi bulan ke-6 ----------
create table kso.verifikasi_bulan6 (
  rencana_id         bigint primary key references kso.rencana_kso(id) on delete cascade,
  serah_terima       date not null,
  volume_dijanjikan  int not null,
  volume_aktual      int,
  rasio              numeric generated always as
                     (case when volume_dijanjikan > 0 and volume_aktual is not null
                           then round(volume_aktual::numeric / volume_dijanjikan, 3) end) stored,
  diverifikasi_at    timestamptz
);

-- ---------- jejak audit ----------
create table kso.riwayat_status (
  id          bigserial primary key,
  rencana_id  bigint references kso.rencana_kso(id) on delete cascade,
  dari        kso.status_rencana,
  ke          kso.status_rencana not null,
  oleh        text,
  at          timestamptz not null default clock_timestamp()   -- jam kejadian sebenarnya, bukan awal transaksi
);

-- ---------- ambang awal (usulan Direktur 15 Okt; finalisasi = UPDATE baris, bukan ubah kode) ----------
-- Di paket rujukan baris ini ada di 004_data_contoh.sql; dipindah ke sini karena ini aturan
-- bisnis, bukan data contoh — mesin gerbang tak bisa jalan tanpa parameter.
insert into kso.parameter values
  ('capex_maks', 60000000, 'Ambang capex jalur cepat (Rp)'),
  ('piutang_hari_maks', 60, 'Umur piutang maksimal (hari)'),
  ('piutang_kelipatan_maks', 3, 'Outstanding maksimal × tagihan bulanan'),
  ('tenor_maks_bulan', 36, 'Tenor maksimal jalur cepat (bulan, sejak serah terima)'),
  ('mandat_berlaku_hari', 30, 'Masa berlaku mandat negosiasi (hari)'),
  ('anti_pecah_hari', 30, 'Jendela aturan anti-pemecahan paket (hari)'),
  ('agenda_a_maks', 3, 'Usulan Agenda A per forum'),
  ('batas_hod_jam_cepat', 24, 'Batas HOD di jalur cepat (jam). Produksi: hitung hari kerja'),
  ('volume_minimum_rasio', 0.8, 'Volume minimum mandat otomatis = rasio × estimasi'),
  ('instalasi_cadangan_persen', 10, 'Bila biaya instalasi belum diisi: PO + cadangan ini melewati ambang → gerbang 1 belum bisa dicek')
on conflict do nothing;
