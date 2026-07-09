-- 052 — F118 Employee Profile Spine (+ F119 bobot BSC). Model per-karyawan:
-- BSC 4-perspektif objektif · OKR · KPI · PDCA · RACI assignment · tools/tasks ·
-- Voice (pain/idea). Sumber data: mockup WRG-RACI-PDCA-KPI-Dashboard (53 karyawan)
-- → di-seed di migrasi 053. Additive, idempoten. Roster tetap di master_user;
-- employee.id = slug, employee.am_id opsional link ke master_user.

CREATE TABLE IF NOT EXISTS department (
  key   text PRIMARY KEY,
  label text NOT NULL,
  color text
);

-- F119: bobot BSC per departemen (total 100 per dept).
CREATE TABLE IF NOT EXISTS bsc_weight (
  dept        text NOT NULL REFERENCES department(key) ON DELETE CASCADE,
  perspective text NOT NULL CHECK (perspective IN ('fin','cust','proc','learn')),
  weight      int  NOT NULL DEFAULT 0,
  PRIMARY KEY (dept, perspective)
);

CREATE TABLE IF NOT EXISTS employee (
  id             text PRIMARY KEY,                 -- slug (mis. 'angga')
  nama           text NOT NULL,
  dept           text REFERENCES department(key),
  role           text,
  atasan_raw     text,                             -- nama atasan mentah (transkrip)
  hod_key        text,                             -- normalisasi HoD (F129/hod_territory)
  lokasi         text,
  masa           text,
  panggilan      text,
  cabang         text,
  whatsapp       text,
  am_id          text,                             -- link opsional ke master_user
  roster_pending boolean NOT NULL DEFAULT false,
  okr_objective  text,                             -- OKR: 1 objektif per karyawan
  quote          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_dept_idx ON employee (dept);

CREATE TABLE IF NOT EXISTS employee_tool (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  tool text NOT NULL, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS employee_task (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  task text NOT NULL, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bsc_objective (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  perspective text NOT NULL CHECK (perspective IN ('fin','cust','proc','learn')),
  objective text NOT NULL, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS okr_key_result (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  key_result text NOT NULL, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kpi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  name text NOT NULL, target text, frequency text,
  perspective text CHECK (perspective IN ('fin','cust','proc','learn')),
  lower_better boolean NOT NULL DEFAULT false, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pdca_cycle (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  plan_step text, do_step text, check_step text, act_step text, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS raci_assignment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  process text NOT NULL, role_type text NOT NULL, note text, seq int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voice_item (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pain','idea')), content text NOT NULL, seq int NOT NULL DEFAULT 0
);

-- ── Menu RBAC (feature) ──
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('employee-spine', 'Employee Spine', 'Analytics', '/employee-spine', 165)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'employee-spine', true, true, true, true, true FROM access_group g WHERE g.key = 'administrator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'employee-spine', true, true, true, true, false FROM access_group g WHERE g.key = 'operator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'employee-spine', true, true, false, false, false FROM access_group g WHERE g.key = 'viewer' ON CONFLICT DO NOTHING;
