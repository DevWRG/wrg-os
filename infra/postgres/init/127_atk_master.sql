-- 068 — F134 ATK Master (General Affairs): Categories + Suppliers + Items.
--
-- Master data ATK (Alat Tulis Kantor) — 3 tabel referensi standalone yang jadi
-- prasyarat F49 (ATK Stock In/Out Digital Register, belum dikerjakan): kategori
-- barang, pemasok, dan katalog barang ATK. Bukan mirror Accurate (vendor ATK
-- kecil sering belum ter-Accurate) — supplier di sini free-standing, mirip pola
-- vendor_name di F39/F36 tapi tanpa FK opsional ke accurate_vendor karena
-- feature ini murni master data internal, bukan pelacakan transaksi vendor.
--
-- atk_item.category_id / default_supplier_id pakai ON DELETE SET NULL (bukan
-- RESTRICT) — hapus kategori/supplier tidak boleh gagal hanya krn masih dipakai
-- item lama; item cukup kehilangan referensinya (data historis tetap ada).

CREATE TABLE IF NOT EXISTS atk_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atk_supplier (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atk_item (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  unit                text NOT NULL,
  category_id         uuid REFERENCES atk_category(id) ON DELETE SET NULL,
  default_supplier_id uuid REFERENCES atk_supplier(id) ON DELETE SET NULL,
  min_stock           numeric,
  notes               text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atk_item_category_id_idx ON atk_item (category_id);
CREATE INDEX IF NOT EXISTS atk_item_default_supplier_id_idx ON atk_item (default_supplier_id);

COMMENT ON TABLE atk_category IS 'F134 ATK Master — kategori barang ATK (General Affairs).';
COMMENT ON TABLE atk_supplier IS 'F134 ATK Master — pemasok ATK, standalone (bukan mirror accurate_vendor).';
COMMENT ON TABLE atk_item IS 'F134 ATK Master — katalog barang ATK, referensi opsional ke kategori & pemasok default.';
