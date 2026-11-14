-- anonymize-master-hod.sql — WAJIB dijalankan di environment DEMO setelah migrasi.
--
-- KENAPA: migrasi 198_master_hod.sql meng-INSERT nama HoD SUNGGUHAN (nama
-- lengkap, panggilan, alias ejaan) ke master_hod. Migrasi itu jalan di SEMUA
-- environment, jadi DB demo — yang akunnya dibagikan ke tim — ikut memuatnya.
--
-- Skrip ini mengganti nama yang TAMPIL dengan label jabatan
-- ("HOD Demo Sales East", dst). Kolom `peran` dipertahankan.
--
-- SENGAJA TIDAK DIUBAH: `hod_key`. Kunci itu di-hardcode di kode (region
-- East/West di sales.ts & sales-target.ts, watchpoint.ts, approval PO,
-- akses bon sparepart/jadwal teknisi, helpdesk GA) dan dirujuk ~20 kolom tanpa
-- FK. Begitu pula master_territory.hod_panggilan dan deal/lead.pic_hod: lead.ts
-- menurunkan pic_hod = lower(hod_panggilan) lalu memakainya sebagai hod_key.
-- Sisa risiko sama dengan employee.id di anonymize-employee-spine.sql.
--
-- Idempoten. Menolak jalan di database yang bukan *_demo.

SELECT current_database() LIKE '%\_demo' AS is_demo \gset
\if :is_demo
\else
  \set ON_ERROR_STOP 1
  DO $$ BEGIN RAISE EXCEPTION 'ABORT: anonymize-master-hod.sql hanya untuk database *_demo (sekarang: %)', current_database(); END $$;
  \quit
\endif

BEGIN;

UPDATE master_hod SET
  nama       = 'HOD Demo ' || peran,
  panggilan  = 'HOD ' || peran,
  alias      = ARRAY[lower('HOD ' || peran)],
  updated_at = now();

COMMIT;

\echo 'Anonimisasi nama HoD selesai (master_hod).'
