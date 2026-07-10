-- 055 — F119b KPI measurement persistence. Simpan % pencapaian KPI per PERIODE
-- (mis. '2026-07' bulanan / '2026-Q3') → kalkulator skor BSC jadi scorecard
-- ter-track (bukan hitung sekali buang). Idempoten. CATATAN: TIDAK memanggil
-- BEGIN/COMMIT sendiri — runner (scripts/db/migrate.sh) yang mengatur transaksi.

CREATE TABLE IF NOT EXISTS kpi_measurement (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kpi_id          bigint NOT NULL REFERENCES kpi(id) ON DELETE CASCADE,
  period          text   NOT NULL,               -- mis. '2026-07' (bulanan)
  achievement_pct numeric NOT NULL,              -- % capaian (kalkulator cap 120)
  actual          text,                           -- nilai aktual mentah (opsional)
  note            text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, period)
);
CREATE INDEX IF NOT EXISTS kpi_measurement_period_idx ON kpi_measurement (period);
