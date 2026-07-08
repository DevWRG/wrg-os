-- 050 — F127 HoD team-level scoping: tautkan akun login (app_user) ke hod_key
-- (kunci di hod_territory, migrasi 041) supaya HoD hanya melihat data cabang
-- timnya di Sales Analytics. Additive, idempoten. Diisi manual via menu User
-- Access (admin) — tak ada backfill otomatis (tak ada sinyal andal login→hod_key).

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS hod_key text;
CREATE INDEX IF NOT EXISTS app_user_hod_key_idx ON app_user (hod_key);

COMMENT ON COLUMN app_user.hod_key IS 'F127 — link ke hod_territory.hod_key (scope tim per-cabang). NULL utk non-HoD / lihat-semua.';
