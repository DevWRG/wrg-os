-- 080 — F41 Forecast vs Actual PO Gap Report (Purchasing), lanjutan F13 PO
-- Tracker (078) + F35 PO Approval Workflow (079, kolom purchase_order.lini).
--
-- Tidak ada sumber "forecast" pembelian di manapun di sistem ini sebelum
-- fitur ini — tabel baru murni input rencana/anggaran pembelian manual, di-
-- scope per periode (bulan/tahun) + lini opsional (IVD/Medical, sama vocab
-- dgn purchase_order.lini; NULL = forecast keseluruhan/semua lini, termasuk
-- PO legacy_exempt yang lini-nya NULL). "Actual" & "gap" DIHITUNG di query
-- terhadap purchase_order/purchase_order_item (SUM qty_ordered/unit_price
-- pada PO non-cancelled di periode+lini yang cocok) — bukan kolom tersimpan,
-- pola computed sama "telat" F39/"variance" F51/status PO F13/F35.
--
-- Unique index pakai COALESCE(lini,'_ALL_') krn NULL secara semantik SQL
-- tidak dianggap sama dgn NULL lain oleh UNIQUE constraint biasa — tanpa ini,
-- dua baris forecast "seluruh lini" bisa dobel utk periode yang sama.

CREATE TABLE IF NOT EXISTS purchase_forecast (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year    int NOT NULL,
  period_month   int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  lini           text CHECK (lini IN ('IVD','Medical')),
  forecast_value numeric NOT NULL CHECK (forecast_value >= 0),
  forecast_qty   numeric CHECK (forecast_qty >= 0),
  notes          text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_forecast_period_lini_uidx
  ON purchase_forecast (period_year, period_month, COALESCE(lini, '_ALL_'));

COMMENT ON TABLE purchase_forecast IS
  'F41 Forecast vs Actual PO Gap Report — rencana/anggaran pembelian per periode+lini (manual), dibandingkan terhadap realisasi purchase_order/purchase_order_item (computed).';
