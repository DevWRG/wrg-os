-- 046 — Target penjualan per tahun/periode/region (kartu Sales Performance).
-- Additive, idempoten. Diisi via menu Admin → Sales Targets (form).
-- CATATAN: nama `sales_region_target` (BUKAN `sales_target` — itu tabel legacy
-- CRM per-AM dari migration 003).
--   period ∈ (year, quarter, month)  — target tahunan / kuartalan / bulanan
--   region ∈ (East, West)            — total = East + West (OFFICE tak ditargetkan)
CREATE TABLE IF NOT EXISTS sales_region_target (
  year       int         NOT NULL,
  period     text        NOT NULL CHECK (period IN ('year', 'quarter', 'month')),
  region     text        NOT NULL CHECK (region IN ('East', 'West')),
  target     numeric     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, period, region)
);
