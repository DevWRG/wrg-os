-- 071 — F49/F54 merge: Kategori Transaksi (Barang / Materai) di atk_item.
--
-- F54 (Materai/Stempel Inventory) awalnya dianggap modul terpisah, tapi
-- requirement direvisi: Materai cuma jadi KATEGORI TRANSAKSI di dalam modul
-- Stock In/Out/Opname F49 yang sudah ada — bukan tabel/endpoint/halaman baru.
-- Workflow (ledger in/out, computed current_stock, opname+variance) tetap
-- persis sama, tanpa duplikasi business logic.
--
-- transaction_category ditaruh di atk_item (bukan atk_category maupun
-- atk_stock_movement/atk_stock_opname):
--   - Bukan di atk_category — category_id di atk_item pakai ON DELETE SET
--     NULL (068); kalau taruh penanda Barang/Materai di sana, hapus/ganti
--     kategori bisa diam-diam menghilangkan penanda materai suatu item.
--   - Bukan di movement/opname — kategori transaksi adalah sifat barangnya
--     (permanen), bukan sifat kejadian mutasinya. Movement/opname cukup ikut
--     lewat JOIN item_id yang sudah ada, skemanya tidak perlu diubah.
--
-- Default 'barang' + backfill otomatis via DEFAULT — semua atk_item lama
-- (sebelum F54 ada) tetap valid tanpa migrasi data manual.

ALTER TABLE atk_item ADD COLUMN IF NOT EXISTS transaction_category text NOT NULL DEFAULT 'barang'
  CHECK (transaction_category IN ('barang', 'materai'));

COMMENT ON COLUMN atk_item.transaction_category IS 'F49/F54 merge — kategori transaksi tingkat-atas (Barang vs Materai), terpisah dari atk_category (sub-klasifikasi bebas-teks).';
