-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy match #REPORT → deal (similarity())

-- pgvector OPSIONAL: direncanakan untuk RAG Walk+, tapi sampai sekarang tak ada
-- satu pun kolom/tipe `vector` di schema maupun kode (sudah dicek 2026-09-02),
-- dan server prod pun tidak memasangnya. Dulu baris ini `CREATE EXTENSION
-- "vector"` polos → migrasi 001 GAGAL di mesin tanpa pgvector, sehingga
-- environment baru (demo/dev bersih) TAK BISA dibangun dari repo; prod lolos
-- cuma karena ledger-nya di-`--baseline`. Dibungkus supaya opsional.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector tak tersedia — dilewati (belum dipakai schema mana pun)';
END $$;

-- CATATAN: `CREATE DATABASE langfuse` DIHAPUS dari sini. Runner migrasi
-- (scripts/db/migrate.sh) membungkus tiap file dalam transaksi, dan CREATE
-- DATABASE haram di dalam transaksi → file ini otomatis gagal. Langfuse dibuat
-- manual sekali saat setup server: `createdb langfuse`.
