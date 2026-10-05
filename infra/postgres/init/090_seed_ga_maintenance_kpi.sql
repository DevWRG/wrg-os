-- 090 — F137: seed 1 KPI baru ke kartu performa Dito (Employee Spine,
-- migrasi 052/053) — "Feed BSC Financial" dari brief F137. INI PRESEDEN
-- PERTAMA auto-feed ke kpi_measurement (repo/ga-maintenance.ts
-- runGaMaintenanceBscFeed, cron bulanan) — sebelumnya semua kpi_measurement
-- diisi manual lewat UI.
--
-- Formula achievement_pct: % maintenance selesai on-time bulan itu (ASUMSI
-- teknis, brief cuma sebut nama KPI bukan rumus — gampang diganti tanpa
-- ubah skema kalau Direktur mau basis lain, mis. cost_actual/cost_budget).

INSERT INTO kpi (employee_id, name, target, frequency, perspective, lower_better, seq)
SELECT 'dito', 'Aset utilization/maintenance cost', '100% tepat waktu', 'Bulanan', 'fin', false, 10
WHERE EXISTS (SELECT 1 FROM employee WHERE id = 'dito')
  AND NOT EXISTS (
    SELECT 1 FROM kpi WHERE employee_id = 'dito' AND name = 'Aset utilization/maintenance cost'
  );
