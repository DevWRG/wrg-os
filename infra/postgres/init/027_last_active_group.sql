-- 027_last_active_group.sql — track grup terakhir tiap user submit (untuk
-- compliance reminder per-grup plan_check/report_check).
ALTER TABLE master_user ADD COLUMN IF NOT EXISTS last_active_group TEXT;
ALTER TABLE master_user ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
