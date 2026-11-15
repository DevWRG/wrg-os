-- 321 — F19 Forecast: jenis penjualan dasar rata-rata (KSO / Regular / keduanya).
--
-- Keputusan user 16 Nov 2026: rata-rata penjualan bisa dihitung dari penjualan
-- KSO saja, Regular saja (semua selain KSO: REGULAR, RUTIN, e-katalog, PL,
-- tanpa kategori), atau keduanya. Sumber: accurate_invoice_item.
-- kategori_pengadaan (charField1 baris faktur Accurate). Pilihan di-snapshot
-- per baris bersama rentangnya.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE forecast_suggestion ADD COLUMN IF NOT EXISTS avg_jenis text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_suggestion_avg_jenis_check') THEN
    ALTER TABLE forecast_suggestion ADD CONSTRAINT forecast_suggestion_avg_jenis_check
      CHECK (avg_jenis IS NULL OR avg_jenis IN ('semua', 'kso', 'regular'));
  END IF;
END $$;

COMMENT ON COLUMN forecast_suggestion.avg_jenis IS
  'F19 — jenis penjualan dasar rata-rata: semua (KSO & Regular), kso, regular (selain KSO). NULL = baris sebelum 321 (semua).';
