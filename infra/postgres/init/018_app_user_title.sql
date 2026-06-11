-- Jabatan/posisi pengguna dashboard (mis. "HOD", "Manager", "Staff"), terpisah
-- dari `role` yang dipakai untuk otorisasi (admin/user). Ditampilkan di UI
-- sebagai "<title> · <role>" (mis. "HOD · admin").
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS title VARCHAR(60);
