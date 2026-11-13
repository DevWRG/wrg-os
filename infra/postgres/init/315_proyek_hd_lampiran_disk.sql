-- Proyek HD: lampiran catatan tahap disimpan di DISK SERVER WRG-OS, bukan Google Drive
-- (keputusan user 13 Nov 2026 — "pakai akses yang ada di wrg-os, tanpa gdrive").
-- Pola sama dgn Kontrak KSO (F47): berkas di PROYEK_HD_UPLOAD_DIR
-- (default ~/.wrg-os/uploads/proyek-hd, ikut backup-media.sh), diunduh lewat API berizin.
--
-- Tabel masih kosong di semua lingkungan saat migrasi ini ditulis (modul baru), jadi
-- kolom Drive dibuang tanpa pemindahan data.

ALTER TABLE hd_lampiran ADD COLUMN IF NOT EXISTS nama_simpan TEXT;
ALTER TABLE hd_lampiran DROP COLUMN IF EXISTS drive_file_id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM hd_lampiran WHERE nama_simpan IS NULL) THEN
    ALTER TABLE hd_lampiran ALTER COLUMN nama_simpan SET NOT NULL;
  END IF;
END $$;
