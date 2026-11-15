-- 317 — F19 Forecast: satu DOKUMEN per cabang × kategori × bulan.
--
-- Keputusan user 15 Nov 2026 (uji dev): usulan jangan diajukan satu-satu per
-- barang. Generate mengumpulkan semua barang satu cabang ke satu dokumen,
-- dipecah per kategori (IVD / Medical) karena approver tahap 2 ditentukan
-- kategori. Satu dokumen = satu approval_request. Wilayah approval (tahap 1)
-- ikut cabang — dipetakan sekali lewat Setup, bukan dipilih tiap Ajukan.
-- Purchasing lalu melihat REKAP semua cabang per barang per bulan.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- Wilayah approval per gudang cabang (east → HoD Sales East, west → West).
-- NULL = belum dipetakan; dokumen cabang itu tak bisa diajukan.
ALTER TABLE warehouse ADD COLUMN IF NOT EXISTS wilayah text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_wilayah_check') THEN
    ALTER TABLE warehouse ADD CONSTRAINT warehouse_wilayah_check CHECK (wilayah IS NULL OR wilayah IN ('east', 'west'));
  END IF;
END $$;

COMMENT ON COLUMN warehouse.wilayah IS
  'F19 — wilayah approval forecast (east/west) untuk gudang cabang. Diisi lewat Setup Forecast. NULL = belum dipetakan.';

CREATE TABLE IF NOT EXISTS forecast_dokumen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode                text NOT NULL UNIQUE,
  warehouse_kode      text NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE,
  -- NULL = berisi barang yang belum terklasifikasi; harus dipilihkan
  -- kategorinya per baris dulu (baris pindah ke dokumen kategori itu).
  kategori            text CHECK (kategori IS NULL OR kategori IN ('IVD', 'Medical')),
  periode             date NOT NULL CHECK (periode = date_trunc('month', periode)::date),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'closed')),
  approval_request_id uuid REFERENCES approval_request (id),
  submitted_by        text,
  submitted_at        timestamptz,
  closed_by           text,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Satu dokumen draft per cabang × kategori × bulan — generate ulang menambah
-- baris ke dokumen yang sama, bukan membuat dokumen baru.
CREATE UNIQUE INDEX IF NOT EXISTS forecast_dokumen_draft_uq
  ON forecast_dokumen (warehouse_kode, (COALESCE(kategori, '-')), periode) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS forecast_dokumen_periode_idx ON forecast_dokumen (periode, status);

COMMENT ON TABLE forecast_dokumen IS
  'F19 — dokumen forecast per cabang × kategori × bulan. Satu dokumen = satu approval_request (ref_tabel forecast_dokumen).';

ALTER TABLE forecast_suggestion
  ADD COLUMN IF NOT EXISTS dokumen_id uuid REFERENCES forecast_dokumen (id) ON DELETE SET NULL;
ALTER TABLE forecast_suggestion ADD COLUMN IF NOT EXISTS kategori text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_suggestion_kategori_check') THEN
    ALTER TABLE forecast_suggestion ADD CONSTRAINT forecast_suggestion_kategori_check
      CHECK (kategori IS NULL OR kategori IN ('IVD', 'Medical'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS forecast_suggestion_dokumen_idx ON forecast_suggestion (dokumen_id);

COMMENT ON COLUMN forecast_suggestion.dokumen_id IS
  'F19 — dokumen cabang tempat baris ini. NULL hanya untuk usulan lama sebelum 317 (diadopsi saat Generate berikutnya bila masih draft).';
COMMENT ON COLUMN forecast_suggestion.kategori IS
  'F19 — IVD/Medical dari Klasifikasi Produk (product_code.kategori_id 01 = IVD, lainnya Medical), atau dipilih manual bila item belum terklasifikasi.';
