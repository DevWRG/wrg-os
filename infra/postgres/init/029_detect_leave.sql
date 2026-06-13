-- 029_detect_leave.sql — state untuk port detect_leave (auto-deteksi izin/sakit/
-- cuti dari grup HRD + approval admin sebelum rekam ke user_leave).

-- Pending approval cuti — id serial supaya pendek (dipakai sbg "L<id>" di WA).
CREATE TABLE IF NOT EXISTS leave_pending (
  id                SERIAL PRIMARY KEY,
  am_id             TEXT NOT NULL,
  nama              TEXT NOT NULL,
  jenis             TEXT NOT NULL,            -- ijin | sakit | cuti
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  source_message_id TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  decided_by        TEXT
);
CREATE INDEX IF NOT EXISTS leave_pending_status_idx ON leave_pending (status, created_at);

-- Idempotensi scan: tiap message_id grup HRD ditandai sekali (hindari re-LLM).
CREATE TABLE IF NOT EXISTS leave_scan_seen (
  message_id  TEXT PRIMARY KEY,
  status      TEXT,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
