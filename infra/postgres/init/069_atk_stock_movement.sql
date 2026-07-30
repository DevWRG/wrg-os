-- 069 — F135 ATK Stock Movement (General Affairs): Stock In/Out Transactional.
--
-- Ledger transaksi masuk/keluar barang ATK, mengonsumsi katalog F134
-- (atk_item, termasuk min_stock yang sebelumnya belum dipakai kolomnya).
-- Satu tabel flat (bukan header+item spt F36/F51) karena tiap baris memang
-- satu kejadian transaksi berdiri sendiri (satu barang, satu arah, satu
-- tanggal) — tidak ada sub-item yang perlu dikelompokkan.
--
-- item_id sengaja TANPA ON DELETE SET NULL/CASCADE (default = RESTRICT) —
-- beda dari FK category_id/default_supplier_id di atk_item (068). Di sana
-- kategori/pemasok cuma label klasifikasi opsional yang aman lepas; di sini
-- item adalah subjek wajib tiap baris riwayat mutasi stok, jadi barang yang
-- masih punya riwayat transaksi tidak boleh hilang keterkaitannya (audit
-- trail) — retire barang lewat is_active (sudah ada di 068), bukan hapus.
--
-- current_stock / is_low_stock TIDAK disimpan sbg kolom — dihitung di query
-- (SUM in - SUM out per item, dibanding min_stock), pola computed yang sama
-- dgn "telat" F39 / "siap ditutup" F36 / "variance" F51 — tak perlu job
-- scheduler tambahan utk menjaga akurasi.

CREATE TABLE IF NOT EXISTS atk_stock_movement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES atk_item(id),
  movement_type text NOT NULL CHECK (movement_type IN ('in', 'out')),
  qty           numeric NOT NULL CHECK (qty > 0),
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  reference     text,
  pic           text,
  cabang        text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atk_stock_movement_item_id_idx ON atk_stock_movement (item_id);
CREATE INDEX IF NOT EXISTS atk_stock_movement_movement_date_idx ON atk_stock_movement (movement_date);

COMMENT ON TABLE atk_stock_movement IS 'F135 ATK Stock Movement — transaksi stok masuk/keluar barang ATK (General Affairs), item_id RESTRICT jaga audit trail.';
