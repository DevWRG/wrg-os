-- 221 — F34 fase 2: asal tautan KSO-n (Accurate) ↔ kso_asset + satu-alat-satu-aset.
--
-- Diagnostik prod 14 Okt 2026: kunci yang berguna hanya SN di kolom `notes`
-- aset Accurate (1.060 dari 1.077 KSO aktif terisi) ↔ kso_asset.sn_key.
-- Nama faskes TIDAK ada di Accurate, jadi tak bisa jadi kunci.
--
-- Penautan diusulkan otomatis lalu diterapkan manusia, jadi perlu tahu
-- SIAPA yang menautkan agar tautan otomatis bisa dibatalkan massal tanpa
-- menyentuh tautan manual Finance:
--   manual     = diisi orang lewat dialog aset
--   otomatis   = hasil pencocokan peringkat "pasti" (SN sama persis, unik, jenis alat sejalan)
--   konfirmasi = kandidat yang dikonfirmasi orang di layar penautan
--
-- Additive + idempoten. Tak menyentuh view fixed_asset_v.

ALTER TABLE fixed_asset_override
  ADD COLUMN IF NOT EXISTS tautan_sumber text,
  ADD COLUMN IF NOT EXISTS tautan_at     timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_asset_override_tautan_sumber_chk') THEN
    ALTER TABLE fixed_asset_override
      ADD CONSTRAINT fixed_asset_override_tautan_sumber_chk
      CHECK (tautan_sumber IS NULL OR tautan_sumber IN ('manual', 'otomatis', 'konfirmasi'));
  END IF;
END $$;

-- Tautan yang sudah ada sebelum migrasi ini = diisi tangan lewat dialog.
UPDATE fixed_asset_override
   SET tautan_sumber = 'manual', tautan_at = COALESCE(tautan_at, updated_at)
 WHERE kso_asset_id IS NOT NULL AND tautan_sumber IS NULL;

-- Satu alat KSO hanya boleh menempel ke satu aset Accurate — kalau tidak,
-- revenue alat itu terhitung ganda saat rekonsiliasi. Dibuat hanya bila data
-- sekarang bersih; bila ada duplikat, migrasi TIDAK gagal (indeks dilewati,
-- penjagaan tetap ada di aplikasi) dan duplikatnya muncul di NOTICE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fixed_asset_override WHERE kso_asset_id IS NOT NULL
    GROUP BY kso_asset_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE '221: ada kso_asset_id tertaut ke >1 aset — indeks unik fixed_asset_override_kso_uniq dilewati, bereskan dulu';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_override_kso_uniq
      ON fixed_asset_override (kso_asset_id) WHERE kso_asset_id IS NOT NULL;
  END IF;
END $$;
