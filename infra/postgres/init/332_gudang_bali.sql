-- 332 — Gudang cabang baru: BALI.
--
-- Keputusan user 17 Nov 2026 (F19 Forecast, peta cabang penjualan → gudang):
-- penjualan cabang AM "BALI" ikut Gudang Bali sendiri. Belum ada gudang Bali
-- di Accurate → tanpa pemetaan warehouse_accurate; stoknya terbaca 0 sampai
-- gudangnya dibuat di Accurate dan dipetakan (pola sama MALANG, migrasi 320).
--
-- cabang 'BALI' sengaja sama dengan nama cabang AM supaya peta F19 (migrasi
-- 319) cocok otomatis; wilayah approval ikut teritori HoD cabang BALI.
--
-- Idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO warehouse (kode, nama, cabang, urutan, aktif, jenis, catatan) VALUES
  ('BALI', 'Gudang Bali', 'BALI', 105, true, 'cabang', 'Belum ada gudangnya di Accurate (stok 0 sampai dipetakan)')
ON CONFLICT (kode) DO NOTHING;
