-- 222 — DOC #KLAIM: alur persetujuan HoD → Finance (keputusan user 15 Okt 2026).
--
-- Versi awal (117) membiarkan siapa pun yang login menyetujui & menandai
-- dibayar, termasuk klaimnya sendiri, tanpa jejak siapa yang membayar. Kini:
--   - setujui/tolak  = HoD pengaju (hod_key di-SNAPSHOT saat klaim masuk,
--                      pola sama fund_request F138), atau direktur/admin;
--   - tandai dibayar = anggota grup akses 'finance-hod' (atau admin);
--   - pengaju tak boleh memutus/membayar klaimnya sendiri (dibandingkan lewat am_id).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE doc_klaim ADD COLUMN IF NOT EXISTS am_id text;      -- pengaju (master_user.am_id), dasar cek "klaim sendiri"
ALTER TABLE doc_klaim ADD COLUMN IF NOT EXISTS hod_key text;    -- HoD pengaju saat klaim masuk (employee.hod_key)
ALTER TABLE doc_klaim ADD COLUMN IF NOT EXISTS dibayar_by_user_id uuid REFERENCES app_user (id) ON DELETE SET NULL;

-- Klaim lama yang sudah tertaut karyawan: isi pengaju + HoD-nya.
UPDATE doc_klaim d SET am_id = e.am_id, hod_key = e.hod_key
FROM employee e
WHERE d.employee_id = e.id AND d.am_id IS NULL AND d.hod_key IS NULL;

CREATE INDEX IF NOT EXISTS doc_klaim_hod_idx ON doc_klaim (hod_key) WHERE status = 'baru';

COMMENT ON COLUMN doc_klaim.hod_key IS 'HoD pengaju di-snapshot saat klaim masuk — yang berwenang setujui/tolak. NULL = HoD tak diketahui → hanya direktur/admin.';
COMMENT ON COLUMN doc_klaim.dibayar_by_user_id IS 'Akun Finance yang menandai dibayar (222).';
