-- 318 — F19 Forecast: rentang rata-rata penjualan dipilih pemakai.
--
-- Keputusan user 15 Nov 2026: rata-rata terjual/bulan tidak lagi tetap
-- 6 bulan — Supply Chain memilih rentang tanggal sendiri (3 bulan, 6 bulan,
-- atau bebas) saat Generate / Hitung ulang dokumen. Rentangnya di-snapshot per
-- baris supaya angka rata-rata bisa dibaca ulang ("dari periode apa?").
-- Kolom avg_monthly_qty_6m tetap dipakai sebagai nilai rata-ratanya (nama
-- lama dipertahankan agar tak memecah kode/riwayat).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE forecast_suggestion ADD COLUMN IF NOT EXISTS avg_dari date;
ALTER TABLE forecast_suggestion ADD COLUMN IF NOT EXISTS avg_sampai date;

COMMENT ON COLUMN forecast_suggestion.avg_monthly_qty_6m IS
  'F19 — rata-rata qty terjual/bulan dalam rentang avg_dari..avg_sampai (sejak 318; sebelumnya tetap 6 bulan terakhir).';
COMMENT ON COLUMN forecast_suggestion.avg_dari IS
  'F19 — awal rentang rata-rata penjualan yang dipilih pemakai. NULL = baris sebelum 318 (6 bulan terakhir).';
COMMENT ON COLUMN forecast_suggestion.avg_sampai IS
  'F19 — akhir rentang rata-rata penjualan (inklusif).';

-- Buffer dalam PERSEN dari rata-rata penjualan/bulan (keputusan user 15 Nov
-- 2026): stok minimum = buffer_persen% × rata-rata dalam rentang yang dipilih
-- saat Generate. buffer_qty lama (angka tetap) tetap dihormati untuk baris
-- yang belum diubah ke persen; baris baru dari UI hanya mengisi persen.
ALTER TABLE item_stock_buffer ADD COLUMN IF NOT EXISTS buffer_persen numeric(7, 2);
ALTER TABLE item_stock_buffer ALTER COLUMN buffer_qty DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_stock_buffer_persen_check') THEN
    ALTER TABLE item_stock_buffer ADD CONSTRAINT item_stock_buffer_persen_check
      CHECK (buffer_persen IS NULL OR buffer_persen >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_stock_buffer_isi_check') THEN
    ALTER TABLE item_stock_buffer ADD CONSTRAINT item_stock_buffer_isi_check
      CHECK (buffer_persen IS NOT NULL OR buffer_qty IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN item_stock_buffer.buffer_persen IS
  'F19 — buffer dalam % dari rata-rata penjualan/bulan (rentang dipilih saat Generate). Diisi = menggantikan buffer_qty.';

-- Snapshot persen buffer di baris usulan (buffer_qty baris = hasil hitungnya).
ALTER TABLE forecast_suggestion ADD COLUMN IF NOT EXISTS buffer_persen numeric(7, 2);
