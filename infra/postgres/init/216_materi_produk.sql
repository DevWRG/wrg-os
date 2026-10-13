-- 216 — F130 Brosur Digital + Product Knowledge Library.
--
-- Keputusan user (2026-10-13):
--   • Brosur DIUNGGAH dari dashboard; file disimpan di GOOGLE DRIVE (Shared
--     Drive, lewat service account — apps/api/src/gdrive.ts) dan dibuka untuk
--     "siapa pun dengan tautan". WRG-OS menyimpan katalog + id/tautan Drive.
--   • TANPA hashtag WA (#BROSUR dibatalkan user).
--   • Langsung terbit (tanpa persetujuan HoD Business).
--   • Ikut: tautan VIDEO training per produk (YouTube/Drive) — tautan saja.
--
-- akses_publik = brosur: izin "siapa pun dengan tautan" berhasil dipasang?
-- video: tautan bisa dibuka tanpa login (dicek otomatis)? NULL = belum dicek.
-- Additive & idempoten.

CREATE SEQUENCE IF NOT EXISTS materi_produk_kode_seq START 1;

CREATE TABLE IF NOT EXISTS materi_produk (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode          text NOT NULL UNIQUE DEFAULT ('MP-' || lpad(nextval('materi_produk_kode_seq')::text, 4, '0')),
  jenis         text NOT NULL CHECK (jenis IN ('brosur', 'video')),
  judul         text NOT NULL CHECK (btrim(judul) <> ''),
  brand         text,                 -- kanonik (norm_brand) — pengelompokan & pencarian
  kategori      text CHECK (kategori IS NULL OR kategori IN ('IVD', 'Medical', 'Aftersales', 'Lainnya')),
  produk        text,                 -- nama produk/SKU bebas, mis. "Zybio Z3"
  url           text NOT NULL CHECK (url ~ '^https://'),
  drive_file_id text,                 -- brosur: id file di Google Drive
  file_name     text,
  file_mime     text,
  file_size     integer,
  catatan       text,
  aktif         boolean NOT NULL DEFAULT true,
  akses_publik  boolean,
  dicek_at      timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS materi_produk_brand_idx ON materi_produk (upper(brand)) WHERE aktif;
CREATE UNIQUE INDEX IF NOT EXISTS materi_produk_url_uniq ON materi_produk (url) WHERE aktif;

COMMENT ON TABLE materi_produk IS
  'F130: katalog brosur (diunggah dari dashboard, file di Google Drive) + tautan video training per produk. Keputusan user 13 Okt 2026.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON materi_produk TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE materi_produk_kode_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON materi_produk TO wrg_readonly;
  END IF;
END $$;
