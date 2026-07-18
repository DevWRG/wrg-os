-- 058 — F66 NPK Engine: header skor NPK per HoD per semester (hasil compute).
-- SK/WRG/Sales/001/V/2026 Pasal 3 — 7 aspek berbobot, skala 0-100, per semester.
-- computed_from menyimpan breakdown input mentah + flag stub/proxy (audit + kejujuran
-- data: banyak aspek belum punya sumber live → available:false). Additive, idempoten.
-- Nomor migrasi PRD (056/057/058) sudah terpakai fitur lain → dipakai 058/059/060.

CREATE TABLE IF NOT EXISTS npk_score_semester (
  hod_key       text        NOT NULL,
  year          int         NOT NULL,
  period        text        NOT NULL CHECK (period IN ('S1','S2')),  -- S1=Jan-Jun, S2=Jul-Des
  npk           numeric     NOT NULL DEFAULT 0,                      -- 0-100 (bobot tetap SK)
  predikat      text        NOT NULL CHECK (predikat IN
                  ('sangat_baik','baik','cukup','kurang','buruk')),
  computed_from jsonb       NOT NULL DEFAULT '{}'::jsonb,            -- input mentah + flag stub/proxy
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hod_key, year, period)
);

CREATE INDEX IF NOT EXISTS idx_npk_score_period ON npk_score_semester(year, period);

-- Registrasi 2 menu di RBAC (setara tombol "Sync Fitur", deterministik saat deploy).
-- Pola sama 049/051. `npk` = matrix Direktur; `npk-self` = self-view HoD.
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('npk',      'NPK Direktur',    'Analytics', '/npk',      180),
  ('npk-self', 'NPK Saya (HoD)',  'Analytics', '/npk/self', 181)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

-- Administrator: full. Operator: view+create+edit. Viewer: view only.
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, true
FROM access_group g CROSS JOIN (VALUES ('npk'), ('npk-self')) AS f(key)
WHERE g.key = 'administrator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, false
FROM access_group g CROSS JOIN (VALUES ('npk'), ('npk-self')) AS f(key)
WHERE g.key = 'operator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, false, false, false
FROM access_group g CROSS JOIN (VALUES ('npk'), ('npk-self')) AS f(key)
WHERE g.key = 'viewer'
ON CONFLICT (group_id, feature_key) DO NOTHING;
