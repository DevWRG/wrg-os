-- 079 — Golongan AM (SK/WRG/Sales/001/V/2026 Pasal 2.1). Sebelumnya jenjang karir
-- AM tidak tersimpan di mana pun, padahal SK menurunkan DUA target NPK darinya:
--   * Target Customer Aktif per level (Pasal 2.1)  → aspek NPK "Customer"
--   * Target New Customer per bulan (Tabel 6)      → sub-metrik CRM "New Customer Rate"
-- Tanpa kolom ini keduanya harus diketik manual per AM per tahun — menyimpang dari SK
-- dan gampang basi. Nilai targetnya sendiri konstanta SK, ditaruh di kode
-- (apps/api/src/lib/npk-golongan.ts), bukan di tabel: mengubahnya = merevisi SK.
--
-- Kolom nullable: karyawan non-AM dan AM yang belum di-assessment ACE (SK Pasal 9.3)
-- dibiarkan NULL → target turunan tidak berlaku, aspeknya N/A seperti biasa.
-- Additive & idempoten.

ALTER TABLE master_user
  ADD COLUMN IF NOT EXISTS golongan text;

-- OSP = probasi 6 bulan (Pasal 1.2); AM-0..AM-4 = AM Jr I → AM Region (Pasal 2.1).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'master_user_golongan_check'
  ) THEN
    ALTER TABLE master_user
      ADD CONSTRAINT master_user_golongan_check
      CHECK (golongan IS NULL OR golongan IN ('OSP','AM-0','AM-1','AM-2','AM-3','AM-4'));
  END IF;
END $$;

COMMENT ON COLUMN master_user.golongan IS
  'Jenjang karir AM per SK Pasal 2.1: OSP, AM-0 (Jr I), AM-1 (Jr II), AM-2 (Sr I), AM-3 (Sr II), AM-4 (Region). NULL = belum di-assessment.';
