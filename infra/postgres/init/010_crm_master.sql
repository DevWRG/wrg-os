-- Master data CRM (port legacy master_user + master_territory). master_user =
-- roster AM/staff (di-key am_id, sama dgn deal/reminder/todo). master_territory
-- = mapping AM→HOD→cabang→kota.
CREATE TABLE IF NOT EXISTS master_user (
  am_id              VARCHAR(50) PRIMARY KEY,
  nama               VARCHAR(200) NOT NULL,
  panggilan          VARCHAR(50),
  wa_number          VARCHAR(30),
  role               VARCHAR(20) NOT NULL DEFAULT 'AM',   -- AM, HOD, ADMIN, ...
  posisi             VARCHAR(100),
  cabang             VARCHAR(50),
  area               VARCHAR(100),
  aktif              BOOLEAN NOT NULL DEFAULT TRUE,
  wajib_plan_report  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_territory (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_panggilan  VARCHAR(50) NOT NULL UNIQUE,
  hod_panggilan VARCHAR(50) NOT NULL,
  cabang        VARCHAR(50) NOT NULL,
  kota          VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
