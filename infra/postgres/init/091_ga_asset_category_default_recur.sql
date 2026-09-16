-- 091 — F137 tambahan: interval maintenance DEFAULT per kategori aset
-- (ga_asset_categories, F132/086) — brief F137 kasih contoh eksplisit
-- "kendaraan 6 bulan, AC 3 bulan" yg sebelumnya belum diimplementasi
-- (recur_months di ga_maintenance_schedules cuma manual per-jadwal, tanpa
-- default). ALTER dari branch F137 (turunan F132), pola sama F42 nge-ALTER
-- tabel milik F12 — bukan edit ulang migrasi 086.
--
-- Nullable & TANPA seed baris kategori apa pun — F132 sengaja "mulai
-- kosong" (dikonfirmasi user, sama resolusi F53), jadi admin isi sendiri
-- pas bikin/edit kategori "Kendaraan Bermotor"/"AC" dst.

ALTER TABLE ga_asset_categories
  ADD COLUMN IF NOT EXISTS default_recur_months int
    CHECK (default_recur_months IS NULL OR (default_recur_months >= 0 AND default_recur_months <= 60));

COMMENT ON COLUMN ga_asset_categories.default_recur_months IS
  'F137 — default recur_months disodorkan (auto-fill, tetap bisa diubah) saat bikin ga_maintenance_schedules utk aset di kategori ini. NULL = tak ada saran.';
