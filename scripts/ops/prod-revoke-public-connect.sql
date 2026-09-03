-- prod-revoke-public-connect.sql — TUTUP celah: PUBLIC masih boleh CONNECT ke DB prod.
--
-- BELUM PERNAH DIJALANKAN. Perlu persetujuan eksplisit dan dijalankan MANUAL oleh
-- pemilik server — ini mengubah ACL database PRODUKSI, dan urutan yang salah
-- membuat aplikasi prod tak bisa konek.
--
-- MASALAH: `datacl` wrg_os_prod = '=Tc/development'. Grantee kosong = PUBLIC,
-- privilese 'c' = CONNECT, 'T' = TEMPORARY. Artinya SETIAP role di cluster ini —
-- termasuk `wrg_demo_app` yang dipakai environment demo (yang rencananya dibuka
-- ke internet) — bisa membuka koneksi ke database produksi.
--   Yang TIDAK bisa dilakukannya: membaca tabel. PUBLIC punya 0 hak tabel;
--   diverifikasi 2026-09-02 dengan mencoba SELECT accurate_customer sebagai
--   wrg_demo_app → "permission denied for table accurate_customer".
--   Yang MASIH terbaca: katalog sistem (daftar tabel, kolom, nama role). Bukan
--   data bisnis, tapi permukaan yang tak perlu ada bagi aplikasi publik.
--
-- KENAPA URUTANNYA KRITIS: dari 5 role di cluster, hanya `development` (owner) dan
-- `wrg_readonly` yang punya GRANT CONNECT eksplisit. `wrg_app` — role yang dipakai
-- aplikasi prod — dan `wrg_admin` bergantung pada PUBLIC. Kalau PUBLIC dicabut
-- lebih dulu, prod langsung mati. Karena itu: GRANT dulu, REVOKE kemudian, dalam
-- SATU transaksi, dengan verifikasi sebelum COMMIT.
--
-- Cara jalankan (sebagai owner via socket peer):
--   psql -d wrg_os_prod -v ON_ERROR_STOP=1 -f scripts/ops/prod-revoke-public-connect.sql
--
-- Disarankan latih dulu di DB non-prod dengan ACL yang sama defaultnya:
--   sed 's/wrg_os_prod/wrg_os_dev/g' scripts/ops/prod-revoke-public-connect.sql | psql -d wrg_os_dev -v ON_ERROR_STOP=1
--
-- ROLLBACK kalau ada yang tak terduga:
--   GRANT CONNECT, TEMPORARY ON DATABASE wrg_os_prod TO PUBLIC;

BEGIN;

-- 1. Pastikan setiap role yang SAH punya CONNECT eksplisit lebih dulu.
GRANT CONNECT ON DATABASE wrg_os_prod TO wrg_app;
GRANT CONNECT ON DATABASE wrg_os_prod TO wrg_admin;
GRANT CONNECT ON DATABASE wrg_os_prod TO wrg_readonly;   -- sudah punya; idempoten

-- 2. Baru cabut dari PUBLIC. TEMPORARY ikut dicabut: hak membuat temp table di DB
--    prod tak dibutuhkan role mana pun selain owner.
REVOKE CONNECT, TEMPORARY ON DATABASE wrg_os_prod FROM PUBLIC;

-- 3. Verifikasi DI DALAM transaksi yang sama — kalau ada role sah yang kehilangan
--    akses, exception membatalkan seluruh perubahan sebelum sempat berlaku.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['wrg_app', 'wrg_admin', 'wrg_readonly', 'development'] LOOP
    IF NOT has_database_privilege(r, 'wrg_os_prod', 'CONNECT') THEN
      RAISE EXCEPTION 'ABORT: role % kehilangan CONNECT — perubahan dibatalkan', r;
    END IF;
  END LOOP;
  IF has_database_privilege('wrg_demo_app', 'wrg_os_prod', 'CONNECT') THEN
    RAISE EXCEPTION 'ABORT: wrg_demo_app MASIH bisa connect — revoke tak berefek';
  END IF;
END $$;

COMMIT;

\echo 'PUBLIC CONNECT ke wrg_os_prod dicabut. Cek: role aplikasi tetap bisa konek, wrg_demo_app tidak.'
