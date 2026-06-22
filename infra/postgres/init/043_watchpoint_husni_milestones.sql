-- 043 — F76 WatchPoint: seed milestone HoD Husni (BD & GA ⭐ KEYSTONE).
-- BUKAN dummy: ketiga milestone ini state nyata & stabil per canonical sprint
-- (current-sprint.json: "Data Spine MVP HIJAU/GO Monday-ready", production LIVE)
-- + bukti GitHub (F76 dashboard live, orkestrasi DB + migrasi shipped).
-- Metric milestone = target NULL → status dari status_override (lihat watchpoint.ts).
-- Idempoten: ON CONFLICT meng-UPSERT ke state GREEN yang dimaksud.

INSERT INTO watchpoint_metric (hod_key, metric_key, actual, status_override, note)
VALUES
  ('husni', 'spine', NULL, 'GREEN',
   'Data Spine MVP HIJAU/GO — production LIVE sejak Senin 2026-06-16, 31+ migrasi wrg_os_prod, nol gap.'),
  ('husni', 'orch', NULL, 'GREEN',
   'Orkestrasi database — 18 scheduler job aktif, least-privilege roles (039), cutover legacy 100% (markers=22).'),
  ('husni', 'dash', NULL, 'GREEN',
   'Dashboard F76 WatchPoint LIVE — metric-based DB-backed + territory CRUD (PR #348/#352/#354).')
ON CONFLICT (hod_key, metric_key) DO UPDATE
  SET status_override = EXCLUDED.status_override,
      note            = EXCLUDED.note,
      updated_at      = now();
