-- Competitor intelligence (port legacy competitor_intel). Catatan harga/produk
-- pesaing dari lapangan; di-key am_id + customer + vendor.
CREATE TABLE IF NOT EXISTS competitor_intel (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_id           VARCHAR(50),
  customer_name   VARCHAR(200),
  tanggal         DATE NOT NULL,
  vendor          VARCHAR(150) NOT NULL,
  produk          TEXT,
  produk_kategori VARCHAR(100),
  harga_text      TEXT,
  harga_numeric   NUMERIC(14,2),
  konteks         TEXT,
  source          VARCHAR(10) NOT NULL DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ci_vendor ON competitor_intel (vendor);
CREATE INDEX IF NOT EXISTS idx_ci_tanggal ON competitor_intel (tanggal DESC);
