-- F22 Instalasi Alat — hubungkan ke data existing (keputusan Direktur 2026-08-28).
--
-- installation_unit semula SENGAJA self-contained: alat_name / customer_name /
-- teknisi_name semuanya TEXT bebas, tanpa FK (lihat 130_installation_lifecycle.sql,
-- "CRM/HR off-limits utk fitur ini"). Ketahuan saat uji jalur tulis: nama bisa
-- diketik bebas → typo, duplikat beda ejaan, tak bisa di-join ke apa pun.
--
-- Pola yang dipakai: HYBRID FK + snapshot nama, bukan mengganti kolom teks.
--   · FK  → integritas & bisa di-join
--   · TEXT tetap ada → snapshot historis; nama tetap tampil apa adanya walau
--     baris Accurate berubah/terhapus di kemudian hari
-- Sama seperti ga_assets.pic_name_override dan shipment_tracking.
--
-- SEMUA kolom baru NULLABLE, dan itu disengaja meski aturannya "form baru WAJIB
-- pilih dari dropdown":
--   1. Baris LAMA dibiarkan NULL — TIDAK di-backfill. Fuzzy-match nama lama ke
--      id Accurate berisiko salah pasang; di repo ini sudah ada preseden nama
--      customer sama persis tapi beda entitas (Faskes/Customer kembar 744/765).
--   2. Expand-contract (docs/MIGRATIONS.md aturan 2 & 3): migrasi additive naik
--      LEBIH DULU dari kodenya. Kalau kolomnya NOT NULL, app versi lama yang
--      masih jalan akan gagal INSERT sampai kode baru ter-deploy.
-- Kewajiban "harus pilih dari dropdown" ditegakkan di LAPISAN APLIKASI
-- (createInstallation memvalidasi id-nya ada), bukan oleh constraint DB.
--
-- teknisi_id ikut ditambahkan atas konfirmasi eksplisit: teknisi BUKAN data
-- Accurate, sumbernya roster internal teknisi_capacity (punya F8). Preseden
-- teknisnya sudah ada — install_schedule sudah lebih dulu FK ke tabel yang sama.

ALTER TABLE installation_unit
  ADD COLUMN IF NOT EXISTS product_id bigint REFERENCES accurate_item(id),
  ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES accurate_customer(id),
  ADD COLUMN IF NOT EXISTS teknisi_id uuid   REFERENCES teknisi_capacity(id);

COMMENT ON COLUMN installation_unit.product_id IS
  'FK accurate_item. NULL = baris lama (pra-2026-08-28) atau belum di-link. alat_name = snapshot nama saat dipilih.';
COMMENT ON COLUMN installation_unit.account_id IS
  'FK accurate_customer. NULL = baris lama. customer_name = snapshot nama saat dipilih.';
COMMENT ON COLUMN installation_unit.teknisi_id IS
  'FK teknisi_capacity (roster F8, BUKAN Accurate). NULL = baris lama / belum assign. teknisi_name = snapshot nama saat assign.';

-- Index pada FK: dipakai arah balik ("instalasi apa saja untuk alat/customer/
-- teknisi ini"). Postgres TIDAK membuat index otomatis untuk kolom FK — hanya
-- untuk PK/unique — jadi tanpa ini setiap lookup arah balik jadi seq scan.
CREATE INDEX IF NOT EXISTS installation_unit_product_idx ON installation_unit (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS installation_unit_account_idx ON installation_unit (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS installation_unit_teknisi_idx ON installation_unit (teknisi_id) WHERE teknisi_id IS NOT NULL;
