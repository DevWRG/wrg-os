-- BUG-14 — atk_category.name UNIQUE (127_atk_master.sql) case-sensitive di
-- Postgres, jadi "Cairan & Alat Sanitasi" dan "cairan & alat sanitasi"
-- dianggap dua kategori berbeda (duplikat lolos kalau beda huruf besar/kecil).
-- Ganti ke unique index case-insensitive di lower(name); constraint lama
-- didrop supaya tidak dobel (index baru sudah mencakup constraint lama).
ALTER TABLE atk_category DROP CONSTRAINT IF EXISTS atk_category_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS atk_category_name_lower_key ON atk_category (lower(name));
