-- 156 — F133 fix: shared-category multi-PIC assignment BENAR-BENAR exempt
-- dari constraint DB. Bug ditemukan sesi QA jalur tulis 2026-08-27:
-- ga_asset_assignments_active_uniq (migrasi 088) UNIQUE(asset_id) WHERE
-- returned_date IS NULL berlaku UNIVERSAL, tanpa pengecualian utk kategori
-- is_shared — padahal app-layer (assignAsset(), repo/ga-asset-assignment.ts)
-- sengaja skip guard "sudah di-assign" utk shared. Akibatnya assign ke user
-- ke-2 saat user ke-1 masih aktif LOLOS di app-layer lalu 500 duplicate key
-- di DB (predicate index parsial tak bisa join tabel kategori, jadi tak bisa
-- langsung merujuk ga_asset_categories.is_shared).
--
-- Fix: denormalisasi is_shared ke kolom baru is_shared_snapshot (diisi saat
-- INSERT dari kategori aset SAAT itu — snapshot, bukan live join, krn
-- kategori bisa berubah setelah assignment lama tercatat), lalu index unique
-- parsial dibatasi HANYA row non-shared. Kolom baru DEFAULT false (aman utk
-- baris lama yang sudah ada, mayoritas non-shared).

ALTER TABLE ga_asset_assignments ADD COLUMN IF NOT EXISTS is_shared_snapshot boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS ga_asset_assignments_active_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS ga_asset_assignments_active_uniq
  ON ga_asset_assignments (asset_id) WHERE returned_date IS NULL AND NOT is_shared_snapshot;

COMMENT ON COLUMN ga_asset_assignments.is_shared_snapshot IS
  'Snapshot is_shared kategori SAAT assignment dibuat (bukan live join) — dipakai predicate index unique di atas supaya kategori shared BENAR-BENAR exempt dari "1 aset = 1 PIC aktif", bukan cuma dicegat di app-layer (bug F133, sesi QA 2026-08-27).';
