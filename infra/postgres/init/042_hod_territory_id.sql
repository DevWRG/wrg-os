-- 042 — F76 WatchPoint: surrogate id utk hod_territory (addressing CRUD UI).
-- PK (hod_key, cabang) tetap (dedup). id dipakai utk UPDATE/DELETE per baris.
-- Aman di tabel non-kosong: IDENTITY mengisi baris existing otomatis.

ALTER TABLE hod_territory ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS hod_territory_id_key ON hod_territory (id);
