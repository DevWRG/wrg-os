-- 188 — Refresh snapshot KSO lewat fungsi SECURITY DEFINER.
--
-- BUG YANG DIPERBAIKI (ketahuan dari log prod, bukan dari review):
--   [scheduler] kso-mv refresh gagal: must be owner of materialized view
--   kso_asset_produktivitas_mv
-- Sejak 185/187 dipasang, refresh terjadwal GAGAL di tiap sinkron Accurate
-- (tercatat 3× di log error: 10:00, 12:00, 14:00 WIB). Sinkronnya sendiri tetap
-- jalan — try/catch di scheduler bekerja seperti niatnya — tapi kedua snapshot
-- berhenti disegarkan dan diam-diam jadi basi.
--
-- SEBABNYA. `REFRESH MATERIALIZED VIEW` menuntut KEPEMILIKAN, bukan sekadar
-- SELECT. Migrasi 185/187 memberi `GRANT SELECT` ke wrg_app — itu cukup untuk
-- MEMBACA snapshot, dan memang membaca berhasil, jadi tak ada gejala di layar.
-- Yang gagal cuma penyegarannya. Snapshot dimiliki `development` (yang
-- menjalankan migrasi), sedangkan aplikasi konek sebagai `wrg_app`.
--
-- KENAPA BUKAN `ALTER MATERIALIZED VIEW ... OWNER TO wrg_app`. Itu satu baris
-- dan langsung menyelesaikan masalah, tapi melanggar rancangan hak-minimal di
-- migrasi 039: wrg_app sengaja dibatasi DML saja, TANPA DDL/DROP. Menjadikannya
-- pemilik berarti ia boleh menghapus/mengubah snapshot itu.
--
-- Fungsi SECURITY DEFINER menjalankan REFRESH dengan hak PEMILIK meski dipanggil
-- wrg_app, jadi wrg_app tetap tak punya kuasa DDL atas snapshotnya. `search_path`
-- dipatok ke public — tanpa itu SECURITY DEFINER bisa dibajak lewat search_path.
--
-- CONCURRENTLY tetap dipakai (pembacaan tak terkunci saat refresh). Sempat
-- diduga tak boleh di dalam fungsi; diuji di dev — ternyata boleh.
CREATE OR REPLACE FUNCTION kso_refresh_snapshots() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Urutan mengikat: kso_asset_produktivitas_v membaca kso_customer_revenue_mv,
  -- jadi revenue harus segar lebih dulu. Terbalik = snapshot atas dibangun dari
  -- revenue lama, salah tanpa satu pun error muncul.
  REFRESH MATERIALIZED VIEW CONCURRENTLY kso_customer_revenue_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY kso_asset_produktivitas_mv;
END
$fn$;

REVOKE ALL ON FUNCTION kso_refresh_snapshots() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT EXECUTE ON FUNCTION kso_refresh_snapshots() TO wrg_app;
  END IF;
END $$;
