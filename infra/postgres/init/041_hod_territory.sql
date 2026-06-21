-- 041 — F76 WatchPoint: mapping HoD→cabang (canonical AREA PER HOD.xlsx, 62 AM-territory).
-- Dipakai utk hitung metric per-HoD berbasis cabang (revenue, produktivitas, kunjungan,
-- churn) tanpa hardcode di kode. Diisi via scripts/db/import-hod-territory.sh (CSV
-- export dari AREA PER HOD.xlsx). HoD non-cabang (IVD/Finance/dll) tak punya baris.

CREATE TABLE IF NOT EXISTS hod_territory (
  hod_key    text NOT NULL,
  cabang     text NOT NULL,
  source     text NOT NULL DEFAULT 'import',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hod_key, cabang)
);

COMMENT ON TABLE hod_territory IS 'F76 WatchPoint — mapping HoD→cabang (sumber: AREA PER HOD.xlsx via importer).';
