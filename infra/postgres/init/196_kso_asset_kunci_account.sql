-- 196 — Kunci account_id per aset KSO supaya tidak ditimpa skrip pencocok.
--
-- MASALAH. kso_asset hanya punya SATU account_id, tanpa riwayat lokasi. Saat alat pindah
-- faskes, seluruh riwayat tesnya ikut ke account_id yang sedang terpasang. Okt 2026: tiga
-- alat pindah (Agu–Sep 2026) dengan ~17 ribu tes yang tercatat di faskes LAMA. Memindahkan
-- account_id-nya membuat rasio tagih/lapor dan porsi KSO kedua faskes meleset, jadi
-- account_id-nya sengaja ditahan di faskes lama.
--
-- Penahanan itu tidak bertahan: scripts/ops/kso-account-match.mjs --apply menyebar
-- kso_customer_map ke SEMUA aset yang customer_raw-nya cocok, dan diam-diam memindahkan
-- alat tadi ke faskes baru. Mencatat alasannya di catatan_sync juga tidak cukup — impor
-- penuh (kso-asset-import.mjs) menimpa kolom itu.
--
-- KOLOM BARU. Tidak disentuh importer (daftar kolomnya eksplisit) dan dilewati
-- kso-account-match.mjs. Alasan wajib diisi kalau dikunci, supaya kunci tidak jadi
-- misteri yang tak berani dibuka. Kunci dibuka manual:
--   UPDATE kso_asset SET account_id_dikunci = false, account_id_alasan_kunci = NULL WHERE sn_key = '...';
ALTER TABLE kso_asset
  ADD COLUMN IF NOT EXISTS account_id_dikunci boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_id_alasan_kunci text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kso_asset_kunci_beralasan') THEN
    ALTER TABLE kso_asset ADD CONSTRAINT kso_asset_kunci_beralasan
      CHECK (NOT account_id_dikunci OR nullif(btrim(account_id_alasan_kunci), '') IS NOT NULL);
  END IF;
END $$;
