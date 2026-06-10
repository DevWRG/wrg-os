-- Leave/cuti + holiday (port legacy user_leave + master_holiday + detect_leave).
-- Dipakai untuk mengecualikan AM dari reminder plan/report saat cuti/libur.
CREATE TABLE IF NOT EXISTS master_holiday (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tanggal     DATE UNIQUE NOT NULL,
  keterangan  VARCHAR(150) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_leave (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_id       VARCHAR(50) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  jenis       VARCHAR(10) NOT NULL CHECK (jenis IN ('sakit','cuti','ijin')),
  keterangan  TEXT,
  source      VARCHAR(10) NOT NULL DEFAULT 'manual',  -- manual | auto
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_leave_range CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_user_leave_lookup ON user_leave (am_id, start_date, end_date);
