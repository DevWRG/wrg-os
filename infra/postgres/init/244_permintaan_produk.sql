-- 244 — F171 Permintaan Produk Non-Master (Komite Product Development)
--
-- Dasar: deck "KSO Forum" Direktur 20 Okt 2026 (Komite 2 Product Development) — fokus tetap
-- 1.000 SKU, tapi tidak ada permintaan lapangan yang hilang. Pengganti
-- Log-Permintaan-Non-Master-SKU.xlsx. Keputusan user 21 Okt: dicatat lewat form web oleh
-- Sekretaris PD (hashtag WA menyusul); potensi = qty per bulan × harga × 12; mulai kosong.
--
-- Alur: catat (≤ 1 hari kerja) → cek master (ada / bisa substitusi / belum ada) → kelompokkan
-- (penulisan berbeda untuk produk yang sama digabung MANUAL — tidak ditebak mesin) → analisa
-- (faskes unik, harga median, potensi) → kandidat (ambang = parameter, diubah dari layar) →
-- review kuartal: Komite PD mengusulkan, Direksi memutus masuk master / principal baru / tolak.
-- Tidak menyentuh tabel OS lain; account_id & sku_kode tanpa FK keras ke tabel mirror supaya
-- impor ulang Accurate/klasifikasi tak pernah tertahan oleh log ini.

-- ---------- ambang (aturan bisnis; angka final ditetapkan Direksi — UPDATE baris, bukan kode) ----------
create table if not exists public.produk_permintaan_param (
  kunci      text primary key,
  nilai      numeric not null check (nilai >= 0),
  keterangan text not null,
  diubah_oleh text,
  diubah_at  timestamptz not null default now()
);
insert into public.produk_permintaan_param (kunci, nilai, keterangan) values
  ('kandidat_min_faskes', 3, 'Kandidat review: minimal jumlah faskes berbeda yang meminta'),
  ('kandidat_hari', 90, 'Jendela hitung faskes untuk kandidat (hari ke belakang)'),
  ('kandidat_min_potensi', 250000000, 'Kandidat review: minimal potensi nilai per tahun (Rp)'),
  ('sla_hari_kerja', 1, 'Batas pencatatan sejak permintaan masuk (hari kerja)')
on conflict (kunci) do nothing;

-- ---------- kelompok produk (hasil penggabungan manual) ----------
create table if not exists public.produk_permintaan_kelompok (
  id          bigserial primary key,
  nama        text not null check (btrim(nama) <> ''),
  catatan     text,
  dibuat_oleh text not null,
  dibuat_at   timestamptz not null default now(),
  diubah_at   timestamptz not null default now()
);
create unique index if not exists produk_permintaan_kelompok_nama on public.produk_permintaan_kelompok (lower(btrim(nama)));

-- ---------- log permintaan ----------
create table if not exists public.produk_permintaan (
  id               bigserial primary key,
  tanggal_minta    date not null,                       -- kapan faskes/AM meminta (bukan kapan dicatat)
  am_id            text,                                -- master_user.am_id pengaju; NULL = bukan dari AM
  pengaju          text not null check (btrim(pengaju) <> ''),  -- nama pengaju apa adanya (AM, HoD, teknisi)
  account_id       bigint,                              -- accurate_customer.id bila faskes sudah customer
  faskes_nama      text not null check (btrim(faskes_nama) <> ''),
  produk_diminta   text not null check (btrim(produk_diminta) <> ''),  -- persis seperti diminta, tidak dinormalkan
  merek            text,
  qty_bulan        numeric check (qty_bulan > 0),       -- kebutuhan per bulan faskes ini
  satuan           text,
  harga_satuan     numeric check (harga_satuan >= 0),   -- harga yang diminta / harga pasar per satuan
  sumber           text not null default 'lainnya' check (sumber in ('wa','kunjungan','telepon','tender','email','lainnya')),
  cek_master       text not null default 'belum_dicek' check (cek_master in ('belum_dicek','ada','substitusi','belum_ada')),
  sku_kode         text,                                -- product_code.kode yang ada / pengganti
  kelompok_id      bigint references public.produk_permintaan_kelompok(id),
  catatan          text,
  dicatat_oleh     text not null,
  dicatat_at       timestamptz not null default now(),
  diubah_oleh      text,
  diubah_at        timestamptz not null default now(),
  -- SKU wajib bila "ada" atau "bisa substitusi" — tanpa itu cek master tak bisa ditelusuri
  check (cek_master not in ('ada','substitusi') or sku_kode is not null),
  check (tanggal_minta <= (dicatat_at at time zone 'Asia/Jakarta')::date)
);
create index if not exists produk_permintaan_tanggal on public.produk_permintaan (tanggal_minta desc);
create index if not exists produk_permintaan_kelompok_idx on public.produk_permintaan (kelompok_id) where kelompok_id is not null;

-- ---------- review kuartal: usulan Komite PD → putusan Direksi ----------
create table if not exists public.produk_permintaan_review (
  id               bigserial primary key,
  kelompok_id      bigint not null references public.produk_permintaan_kelompok(id),
  kuartal          text not null check (kuartal ~ '^[0-9]{4}-Q[1-4]$'),
  usulan           text not null check (usulan in ('masuk_master','principal_baru','tolak')),
  usulan_catatan   text not null check (btrim(usulan_catatan) <> ''),
  usulan_oleh      text not null,
  usulan_at        timestamptz not null default now(),
  -- ringkasan angka saat diusulkan (bahan forum tetap utuh walau log berubah sesudahnya)
  snapshot         jsonb not null default '{}',
  putusan          text check (putusan in ('masuk_master','principal_baru','tolak')),
  putusan_catatan  text,
  putusan_oleh     text,
  putusan_at       timestamptz,
  unique (kelompok_id, kuartal),
  check (putusan is null or (putusan_catatan is not null and btrim(putusan_catatan) <> '' and putusan_oleh is not null and putusan_at is not null))
);

-- hari kerja antara dua tanggal (tanggal awal tidak dihitung): Sabtu/Minggu & master_holiday dilewati
create or replace function public.produk_permintaan_hari_kerja(p_dari date, p_sampai date) returns int
language sql stable as $$
  select count(*)::int from generate_series(p_dari + 1, p_sampai, interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not exists (select 1 from master_holiday h where h.tanggal = g.d::date)
$$;

-- default privileges 039 sudah memberi DML ke wrg_app; ditulis eksplisit supaya DB baru sama
grant select, insert, update on public.produk_permintaan_param, public.produk_permintaan_kelompok,
  public.produk_permintaan, public.produk_permintaan_review to wrg_app;
grant usage, select on sequence public.produk_permintaan_kelompok_id_seq, public.produk_permintaan_id_seq,
  public.produk_permintaan_review_id_seq to wrg_app;
grant execute on function public.produk_permintaan_hari_kerja(date, date) to wrg_app;
