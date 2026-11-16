-- 319 — F19 Forecast: rata-rata penjualan PER CABANG lewat cabang AM.
--
-- Keputusan user 15 Nov 2026: rata-rata penjualan untuk buffer persen dihitung
-- per gudang cabang, bukan gabungan. Faktur Accurate hampir semua keluar dari
-- satu gudang, jadi cabang diambil dari cabang AM pada tanggal faktur
-- (joinAmFromSalesman + area_customer, sama dengan revenue Per Cabang).
--
-- Nama cabang AM (mis. "SBY 2", "MALANG", "SOLO & YOGYAKARTA") tak selalu sama
-- dengan kode gudang. Nama yang persis sama dengan kode/cabang/nama gudang
-- dipetakan otomatis di kode; sisanya dipetakan pemakai lewat Setup Forecast
-- dan disimpan di sini. Cabang tanpa peta = penjualannya tak dihitung ke
-- gudang mana pun.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS forecast_cabang_gudang (
  cabang         text PRIMARY KEY,
  warehouse_kode text NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE ON DELETE CASCADE,
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE forecast_cabang_gudang IS
  'F19 — peta cabang penjualan (cabang AM pada tanggal faktur) → gudang cabang, untuk rata-rata penjualan per gudang. Diisi lewat Setup Forecast.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON forecast_cabang_gudang TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON forecast_cabang_gudang TO wrg_readonly;
  END IF;
END $$;
