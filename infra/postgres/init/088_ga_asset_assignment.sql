-- 088 — F133 GA Aset Assignment + Transfer + History Timeline. Depends F132
-- (ga_assets, migrasi 086).
--
-- Skema diadaptasi dari gais/003_asset.sql (asset_assignments/asset_transfers)
-- — PIC WAJIB user terdaftar (app_user.id), BUKAN teks bebas seperti pola
-- assignee lain di repo (F22 teknisi, F50 sopir, F52 it_ticket) — dikonfirmasi
-- user, sesuai deskripsi asli fitur. Assignment via nama bebas yang TIDAK
-- match user terdaftar tetap didukung (lihat repo/ga-asset-assignment.ts,
-- resolveUserByName + fallback pic_name_override di ga_assets), tapi TIDAK
-- menghasilkan baris histori di sini — trade-off yang sama diadopsi source
-- (histori lengkap vs fleksibilitas free-text, source pilih fleksibilitas).

CREATE TABLE IF NOT EXISTS ga_asset_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES ga_assets(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  department    text,
  assigned_date date NOT NULL DEFAULT CURRENT_DATE,
  returned_date date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_asset_assignments_asset_idx ON ga_asset_assignments (asset_id);
CREATE INDEX IF NOT EXISTS ga_asset_assignments_user_idx  ON ga_asset_assignments (user_id);

-- Enforce "1 aset = 1 PIC aktif" — TAPI cuma default DB. Kategori is_shared
-- (ga_asset_categories) butuh BOLEH multi-PIC aktif sekaligus; partial unique
-- index tak bisa join kategori langsung (predicate harus statis), jadi
-- exception itu dicek di app-layer (repo/ga-asset-assignment.ts) SEBELUM
-- insert — index ini tetap jalan sbg pengaman utk kategori NON-shared.
-- (Constraint di bawah cuma proteksi race condition kasar; kalau ternyata
-- diperlukan utk kategori shared, di-DROP manual dari app-layer tak mungkin
-- — didesain begini krn kategori shared sengaja tidak mengandalkan constraint
-- DB sama sekali, insert langsung tanpa cek unique.)
CREATE UNIQUE INDEX IF NOT EXISTS ga_asset_assignments_active_uniq
  ON ga_asset_assignments (asset_id) WHERE returned_date IS NULL;

CREATE TABLE IF NOT EXISTS ga_asset_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES ga_assets(id) ON DELETE CASCADE,
  from_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  to_user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  from_location text,
  to_location   text,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reason        text,
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_asset_transfers_asset_idx ON ga_asset_transfers (asset_id);
CREATE INDEX IF NOT EXISTS ga_asset_transfers_date_idx  ON ga_asset_transfers (transfer_date);

COMMENT ON TABLE ga_asset_assignments IS
  'F133 — histori assign/return aset. HANYA tercatat kalau PIC user terdaftar (user_id NOT NULL) — assign via nama bebas yg tak match tercermin di ga_assets.pic_name_override saja, tanpa baris di sini.';
COMMENT ON TABLE ga_asset_transfers IS
  'F133 — histori transfer PIC/lokasi. to_user_id WAJIB user terdaftar (beda dari assign yg punya fallback free-text) — simplifikasi sengaja drpd source gais yg izinkan free-text di transfer juga.';
