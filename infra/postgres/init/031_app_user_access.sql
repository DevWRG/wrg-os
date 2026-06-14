-- 031_app_user_access.sql — kolom tambahan app_user untuk manajemen akses login.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS wa_number TEXT;          -- buat kirim password via WA
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS force_change BOOLEAN NOT NULL DEFAULT false;
