-- 156: hardening role wrg_readonly (lanjutan 039_least_priv_roles.sql).
--
-- 039 sudah memberi wrg_readonly SELECT pada TABLES + default privileges untuk
-- tabel baru. Berkas ini menutup tiga sisa yang selama ini di-apply manual di
-- prod (27 Agu 2026) sehingga tak ikut terbawa ke DB yang dibangun dari nol:
--   1. grant SELECT untuk SEQUENCES (039 hanya mengatur TABLES)
--   2. default privileges SEQUENCES untuk objek baru
--   3. pagar tingkat sesi: default_transaction_read_only + idle timeout
--
-- URUTAN LAPISAN — penting, jangan dibalik saat membaca:
--   Pengunci sesungguhnya adalah GRANT. `default_transaction_read_only` HANYA
--   pagar kecelakaan: parameter itu USERSET, jadi sesi bisa mematikannya sendiri
--   dengan `SET default_transaction_read_only = off` (di statement TERPISAH —
--   dalam satu `psql -c` tidak bisa, karena transaksi implisit sudah telanjur
--   dimulai read-only). Terbukti di prod: setelah SET off, `CREATE TEMP TABLE`
--   berhasil, tetapi `INSERT INTO kso_asset` tetap ditolak
--   "permission denied for table kso_asset".
--
--   KONSEKUENSI PEMELIHARAAN: jangan pernah menambah GRANT tulis apa pun ke
--   wrg_readonly dengan alasan "toh masih ada default_transaction_read_only".
--   Pagar itu tidak menahan apa-apa terhadap sesi yang sengaja melepasnya.
--
-- Idempoten: aman dijalankan ulang.

-- 1) Atribut role — pastikan tak ada privilege cluster-level yang menyelinap.
--    (Sudah default sejak 039, ditegaskan di sini agar tercatat eksplisit.)
ALTER ROLE wrg_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 2) Pagar tingkat sesi. Berlaku cluster-wide untuk role ini (bukan per-database),
--    jadi menjalankan berkas ini di beberapa DB tidak menumpuk efek.
ALTER ROLE wrg_readonly SET default_transaction_read_only = on;
ALTER ROLE wrg_readonly SET idle_in_transaction_session_timeout = '60s';

-- 3) Sequences: 039 hanya mengurus TABLES. Tanpa ini, query yang menyentuh
--    sequence (mis. currval/last_value untuk cek gap id) kena permission denied.
--    SELECT saja — USAGE sengaja TIDAK diberikan karena itu mengizinkan nextval().
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO wrg_readonly;

-- 4) Default privileges untuk sequence BARU. Terikat ke role yang menjalankan
--    berkas ini (owner/migrator) — sama seperti pola di 039.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO wrg_readonly;

-- 5) Tegaskan wrg_readonly tak bisa membuat objek di schema.
REVOKE CREATE ON SCHEMA public FROM wrg_readonly;

-- Catatan cakupan:
--   * Schema `prod_fdw` (foreign table ke wrg_crm_prod) sengaja TIDAK dibuka.
--     Membukanya butuh CREATE USER MAPPING dengan password_required 'false'
--     (superuser-only) plus GRANT terpisah di DB remote — di luar lingkup migrasi.
--   * Role ini mengunci apa yang bisa dilakukan koneksi wrg_readonly, BUKAN
--     mencegah koneksi lain. Owner DB tetap punya akses penuh.
