-- 259 — F173 Pameran: Registrasi Pengunjung & Kupon Undian.
--
-- Kebutuhan divisi Medical & Hemodialisa (30 Okt 2026), bisa dipakai divisi IVD juga.
-- Keputusan user: pengunjung (dokter/visitor) mengisi SENDIRI dari HP lewat QR di booth
-- — halaman publik tanpa login (/daftar/<slug>). Isian: nama, asal institusi, no. HP.
-- Sukses → kode kupon undian doorprize tampil di layar (TIDAK dikirim WA). Satu no. HP =
-- satu kupon per pameran; daftar ulang dengan nomor sama mengembalikan kupon yang sama.
-- Data dikelola di menu Pameran: acara + QR, daftar & export pengunjung, kocok pemenang,
-- dan "jadikan deal" MANUAL (prospek mentah tak otomatis masuk pipeline).
-- Additive & idempoten.

create table if not exists public.pameran (
  id               bigserial primary key,
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),  -- bagian URL form publik
  nama             text not null check (btrim(nama) <> ''),
  divisi           text not null check (divisi in ('medical_hd','ivd')),
  lokasi           text,
  tanggal_mulai    date not null,
  tanggal_selesai  date not null,
  prefix_kupon     text not null check (prefix_kupon ~ '^[A-Z]{2,5}$'),
  buka             boolean not null default true,   -- form publik menerima pendaftaran
  dibuat_oleh      text not null,
  dibuat_at        timestamptz not null default now(),
  diubah_at        timestamptz not null default now(),
  check (tanggal_selesai >= tanggal_mulai)
);

create table if not exists public.pameran_pengunjung (
  id           bigserial primary key,
  pameran_id   bigint not null references public.pameran(id) on delete cascade,
  nama         text not null check (btrim(nama) <> ''),
  institusi    text not null check (btrim(institusi) <> ''),
  no_hp        text not null check (no_hp ~ '^628[0-9]{7,12}$'),   -- dinormalkan ke 62…
  kode_kupon   text not null unique,
  daftar_at    timestamptz not null default now(),
  ip           text,
  user_agent   text,
  deal_id      text,                                               -- diisi saat "jadikan deal"
  unique (pameran_id, no_hp)
);
create index if not exists pameran_pengunjung_pameran on public.pameran_pengunjung (pameran_id, daftar_at desc);

-- Pemenang undian. Satu pengunjung paling banyak SATU baris (menang sekali); pemenang yang
-- tak hadir ditandai 'hangus' — barisnya tetap ada supaya tak ikut terkocok lagi.
create table if not exists public.pameran_undian (
  id             bigserial primary key,
  pameran_id     bigint not null references public.pameran(id) on delete cascade,
  pengunjung_id  bigint not null unique references public.pameran_pengunjung(id) on delete cascade,
  hadiah         text not null check (btrim(hadiah) <> ''),
  status         text not null default 'menang' check (status in ('menang','hangus')),
  diundi_oleh    text not null,
  diundi_at      timestamptz not null default now()
);
create index if not exists pameran_undian_pameran on public.pameran_undian (pameran_id, diundi_at);
