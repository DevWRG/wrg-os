-- Territory AM = many-to-many. Realita legacy (wrg-crm master_territory): satu
-- AM (am_panggilan) meng-cover BANYAK cabang/kota — mis. 1 AM → 15 baris
-- territory. Skema awal (010) salah mengasumsikan 1 territory per AM lewat
-- UNIQUE(am_panggilan), sehingga import data produksi kehilangan coverage.
--
-- Perbaikan: lepas UNIQUE(am_panggilan), pakai UNIQUE(am_panggilan, cabang, kota)
-- supaya satu AM boleh punya banyak territory selama kombinasinya unik.
-- upsertTerritory (apps/api repo) ikut di-update ke ON CONFLICT triple ini.

ALTER TABLE master_territory DROP CONSTRAINT IF EXISTS master_territory_am_panggilan_key;
ALTER TABLE master_territory
  ADD CONSTRAINT master_territory_am_cabang_kota_key UNIQUE (am_panggilan, cabang, kota);
