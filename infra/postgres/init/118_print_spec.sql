-- 096 — F44 Document Print Spec Standardizer.
--
-- Modul BARU, berdiri sendiri (master data referensi, tanpa FK ke tabel
-- manapun) — sama filosofi "self-contained" F43 (095): dev belum punya tabel
-- SJ/BAST/TTF terstruktur (branch shipping F12/F42/F45/F93 belum merge), jadi
-- document_type SENGAJA teks bebas (bukan FK/enum tertutup) supaya menu ini
-- tetap bisa mendefinisikan standar cetak untuk dokumen shipping yang belum
-- ada tabelnya maupun dokumen yang sudah ada (mis. sales_doc/SPH — domain CRM,
-- TIDAK disentuh sama sekali di sini, cuma dicatat sebagai label jenis dokumen).
--
-- Satu baris = satu standar cetak aktif per jenis dokumen (unique case-
-- insensitive di document_type) — retire lewat is_active (pola sama F134 ATK
-- Master), bukan hapus, karena tak ada riwayat transaksi yang bergantung ke
-- baris ini.

CREATE TABLE IF NOT EXISTS print_spec (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type     text NOT NULL,
  paper_size        text NOT NULL DEFAULT 'A4'
                       CHECK (paper_size IN ('A4','A5','A6','F4','Letter')),
  orientation       text NOT NULL DEFAULT 'portrait'
                       CHECK (orientation IN ('portrait','landscape')),
  margin_top_mm     integer NOT NULL DEFAULT 20 CHECK (margin_top_mm >= 0),
  margin_right_mm   integer NOT NULL DEFAULT 20 CHECK (margin_right_mm >= 0),
  margin_bottom_mm  integer NOT NULL DEFAULT 20 CHECK (margin_bottom_mm >= 0),
  margin_left_mm    integer NOT NULL DEFAULT 20 CHECK (margin_left_mm >= 0),
  font_family       text NOT NULL DEFAULT 'Arial',
  font_size_pt      numeric(4,1) NOT NULL DEFAULT 11 CHECK (font_size_pt > 0),
  has_letterhead    boolean NOT NULL DEFAULT true,
  header_spec       text,
  footer_spec       text,
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS print_spec_document_type_lower_idx
  ON print_spec (lower(document_type));
CREATE INDEX IF NOT EXISTS print_spec_is_active_idx ON print_spec (is_active);

COMMENT ON TABLE print_spec IS
  'F44 Document Print Spec Standardizer — standar cetak (paper size/margin/font/header-footer) per jenis dokumen, master data standalone tanpa FK.';
