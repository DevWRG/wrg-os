-- 213 — Forecast pembelian per bulan × lini × VENDOR (rombak F41, 13 Okt 2026).
--
-- Konteks: purchase_order kini cermin PO Accurate (migrasi 205) — kolom
-- purchase_order.lini (isian manual F35) KOSONG di semua PO Accurate, jadi
-- forecast per lini versi 148 selalu menunjukkan realisasi 0. Keputusan user:
--   - forecast dipecah per lini DAN vendor; brand = tampilan analisis saja
--     (vendor ≈ principal, data vendor 100% lengkap di PO Accurate);
--   - lini TIDAK lagi dari purchase_order.lini, tapi diturunkan per barang PO
--     lewat Klasifikasi Produk (product_code.kategori: IVD → 'IVD', selain itu
--     → 'Medical'); barang belum terklasifikasi tampil terpisah di laporan;
--   - forecast dalam rupiah saja — qty lintas satuan (box/kit/pcs) tak bermakna.
--
-- ALTER atas tabel dari 148 (bukan edit 148): 148 sudah ter-apply di dev.
-- Di prod keduanya jalan berurutan dalam promosi yang sama.

ALTER TABLE purchase_forecast ADD COLUMN IF NOT EXISTS vendor_id bigint REFERENCES accurate_vendor(id) ON DELETE SET NULL;
ALTER TABLE purchase_forecast ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE purchase_forecast DROP COLUMN IF EXISTS forecast_qty;

DROP INDEX IF EXISTS purchase_forecast_period_lini_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_forecast_period_lini_vendor_uidx
  ON purchase_forecast (period_year, period_month, COALESCE(lini, '_ALL_'), COALESCE(vendor_id, 0));

COMMENT ON COLUMN purchase_forecast.vendor_id IS
  'Vendor Accurate (accurate_vendor.id) — NULL = semua vendor. vendor_name = snapshot nama untuk tampilan.';
COMMENT ON TABLE purchase_forecast IS
  'F41 rencana pembelian per bulan × lini (IVD/Medical/NULL=semua) × vendor (NULL=semua), rupiah. Realisasi dihitung dari PO Accurate (purchase_order/_item); lini per barang via product_code.';
