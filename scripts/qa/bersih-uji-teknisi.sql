-- Hapus data dummy uji Teknisi (pasangan scripts/qa/seed-uji-teknisi.sql) — HANYA wrg_os_dev.
--
--   psql -d wrg_os_dev -v ON_ERROR_STOP=1 -f scripts/qa/bersih-uji-teknisi.sql
--
-- Teknisi UJI-TEKNISI-F175 TIDAK dihapus (dipakai alias grup Research untuk uji WA).
-- jadwal_rutin_bulan TIDAK dihapus (bisa berisi jadwal asli bulan ini).

DO $$
BEGIN
  IF current_database() <> 'wrg_os_dev' THEN
    RAISE EXCEPTION 'bersih-uji-teknisi hanya untuk wrg_os_dev (sekarang: %)', current_database();
  END IF;
END $$;

BEGIN;
DELETE FROM teknisi_kunjungan WHERE account_id IN (990001751, 990001752) OR faskes_teks ILIKE '%ujif175%';
DELETE FROM teknisi_plan_item WHERE account_id IN (990001751, 990001752) OR faskes_teks ILIKE '%ujif175%';
DELETE FROM jadwal_rutin WHERE account_id IN (990001751, 990001752);
DELETE FROM service_ticket WHERE id = 'f1750000-0000-4000-8000-0000000071c7';
DELETE FROM installation_unit WHERE id = 'f1750000-0000-4000-8000-000000000b03';  -- install & maintenance ikut (CASCADE)
DELETE FROM kso_asset WHERE sn_key IN ('UJ75A101', 'UJ75A202');
DELETE FROM accurate_customer WHERE id IN (990001751, 990001752);
COMMIT;
