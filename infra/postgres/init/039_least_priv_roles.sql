-- 039: least-privilege DB roles.
-- App sebaiknya konek sebagai wrg_app (DML-only), BUKAN superuser. DDL/migrasi
-- tetap dijalankan role owner (development di prod / wrg di local) via migrate.sh.
--
-- Role dibuat TANPA password (dormant — tak bisa login lewat TCP sampai password
-- di-set). Set password & cutover DATABASE_URL = langkah MANUAL saat go-live,
-- lihat docs/SECURITY-DEV-ACCESS.md §Cutover. JANGAN taruh secret di file ini.
--
-- Idempoten: aman dijalankan ulang.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wrg_app') THEN
    CREATE ROLE wrg_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    CREATE ROLE wrg_readonly LOGIN;
  END IF;
END $$;

-- Akses schema
GRANT USAGE ON SCHEMA public TO wrg_app, wrg_readonly;

-- wrg_app: DML pada semua tabel + sequence yang ADA. TANPA DDL/DROP/TRUNCATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wrg_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wrg_app;

-- wrg_readonly: SELECT saja (analitik/debug).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wrg_readonly;

-- Default privileges → objek BARU (dibuat oleh role yg menjalankan file ini,
-- yaitu owner/migrator) otomatis ter-grant ke wrg_app/wrg_readonly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wrg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wrg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO wrg_readonly;

-- Catatan: wrg_app sengaja TIDAK diberi CREATE di schema (tak bisa bikin/ubah
-- tabel). Untuk hardening lebih lanjut, owner bisa:
--   REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- (tidak dilakukan otomatis di sini agar tak mengunci akses tak sengaja.)
