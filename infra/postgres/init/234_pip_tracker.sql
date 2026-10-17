-- 234 — F70 Performance Improvement Plan (PIP) 90-Day Tracker (HR). Additive, idempoten.
--
-- Empat tabel, semuanya menempel ke `employee` (052) — hub identitas yang sama dengan
-- Raport 360 / Karyawan 360 (jembatan employee.am_id → master_user.am_id):
--   pip_case       — satu perjalanan PIP satu karyawan. 90 hari sejak start_date; end_date bisa
--                    digeser lewat outcome 'extend' (jumlah & durasi perpanjangan TIDAK dibatasi
--                    skema — belum diputuskan Direktur).
--   pip_goal       — improvement goal milik case.
--   pip_milestone  — milestone (gate) dengan tenggat; status diputus manusia.
--   pip_checkin    — check-in mingguan (API hanya menambah; tak ada jalur edit/hapus).
--
-- Jejak audit TIDAK punya tabel sendiri: ditulis ke audit_log (002_governance, append-only
-- lewat RULE) dengan use_case_id 'F70' dan correlation_id 'f70-case-<id>' — pola F60.
-- employee_id memakai ON DELETE RESTRICT: dokumen compliance tak boleh ikut hilang
-- karena baris karyawan dihapus.

CREATE TABLE IF NOT EXISTS pip_case (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id  text NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','graduate','terminate')),
  alasan       text NOT NULL,
  outcome_note text,
  closed_at    timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
-- Satu karyawan hanya boleh punya SATU PIP aktif (case yang sudah ditutup boleh banyak).
CREATE UNIQUE INDEX IF NOT EXISTS pip_case_aktif_uq ON pip_case (employee_id) WHERE status = 'aktif';
CREATE INDEX IF NOT EXISTS pip_case_status_idx ON pip_case (status, start_date DESC);

CREATE TABLE IF NOT EXISTS pip_goal (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    bigint NOT NULL REFERENCES pip_case(id) ON DELETE CASCADE,
  goal       text NOT NULL,
  target     text,
  seq        int NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pip_goal_case_idx ON pip_goal (case_id, seq, id);

CREATE TABLE IF NOT EXISTS pip_milestone (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    bigint NOT NULL REFERENCES pip_case(id) ON DELETE CASCADE,
  judul      text NOT NULL,
  due_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'belum' CHECK (status IN ('belum','tercapai','tidak_tercapai')),
  catatan    text,
  decided_by text,
  decided_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pip_milestone_case_idx ON pip_milestone (case_id, due_date, id);

CREATE TABLE IF NOT EXISTS pip_checkin (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id      bigint NOT NULL REFERENCES pip_case(id) ON DELETE CASCADE,
  week_no      int NOT NULL CHECK (week_no >= 1),    -- minggu ke-N sejak start_date (dihitung server)
  checkin_date date NOT NULL,
  catatan      text NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pip_checkin_case_idx ON pip_checkin (case_id, checkin_date, id);

COMMENT ON TABLE pip_case IS
  'F70: perjalanan PIP satu karyawan. extend = end_date digeser (angka dari pengguna, tanpa batas bawaan); graduate/terminate menutup case.';
