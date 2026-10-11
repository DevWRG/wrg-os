-- 189_leave_backup_pic.sql — F55 Cuti & Backup PIC Registry.
-- Penunjukan pengganti (backup PIC) saat karyawan cuti/sakit/ijin. Satu kolom
-- di user_leave; wajib untuk jenis 'cuti' (ditegakkan di API, bukan CHECK —
-- baris lama & baris source='auto' dari /leave/detect tidak punya pengganti).
-- Anti-dobel notifikasi WA memakai notif_state (key 'f55:leave:<id>'), jadi
-- tidak perlu kolom status kirim. leave_pending sengaja tidak ditambah kolom:
-- pengganti dipilih saat approve (dashboard/WA), bukan saat deteksi.
-- Additive & idempoten.
ALTER TABLE user_leave ADD COLUMN IF NOT EXISTS backup_am_id VARCHAR(50);

COMMENT ON COLUMN user_leave.backup_am_id IS
  'F55: master_user.am_id pengganti selama cuti. NULL = belum/tidak ditunjuk.';
