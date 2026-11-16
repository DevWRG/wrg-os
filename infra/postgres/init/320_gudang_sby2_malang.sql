-- 320 — Gudang cabang baru: SBY2 (Surabaya 2) dan MALANG.
--
-- Keputusan user 15 Nov 2026 (F19 Forecast, peta cabang penjualan → gudang):
-- cabang AM "SBY 2" dilayani Gudang Surabaya 2 dan "MALANG" dilayani Gudang
-- Malang, masing-masing gudang cabang sendiri.
--
-- · SBY2: GUDANG SURABAYA2 (Accurate id 200) DIPISAH dari SBY. Sebelumnya
--   tiga gudang Surabaya dijumlahkan ke SBY (keputusan 2026-09-06, migrasi
--   166); kini SBY = GUDANG SURABAYA + GUDANG SURABAYA 1, SBY2 = SURABAYA2.
--   Stok per cabang (item_stock_branch) ikut terpisah pada sinkron stok
--   Accurate berikutnya.
-- · MALANG: belum ada gudangnya di Accurate → tak ada pemetaan
--   warehouse_accurate; stoknya terbaca 0 sampai gudang Malang dibuat di
--   Accurate dan dipetakan.
--
-- cabang 'SBY 2' / 'MALANG' sengaja sama dengan nama cabang AM, supaya peta
-- cabang penjualan → gudang F19 (migrasi 319) cocok otomatis.
--
-- Idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO warehouse (kode, nama, cabang, urutan, aktif, jenis, catatan) VALUES
  ('SBY2',   'Gudang Surabaya 2', 'SBY 2',  11, true, 'cabang', 'GUDANG SURABAYA2 di Accurate — dipisah dari SBY 15 Nov 2026'),
  ('MALANG', 'Gudang Malang',     'MALANG', 45, true, 'cabang', 'Belum ada gudangnya di Accurate (stok 0 sampai dipetakan)')
ON CONFLICT (kode) DO NOTHING;

UPDATE warehouse SET catatan = 'GUDANG SURABAYA + GUDANG SURABAYA 1 (SURABAYA2 → SBY2 sejak 15 Nov 2026)'
WHERE kode = 'SBY';

UPDATE warehouse_accurate
SET warehouse_kode = 'SBY2', catatan = 'Dipisah dari SBY jadi gudang cabang sendiri (keputusan 2026-11-15)'
WHERE accurate_warehouse_id = 200 AND warehouse_kode = 'SBY';

UPDATE warehouse_accurate
SET catatan = 'Dijumlahkan ke SBY (GUDANG SURABAYA + GUDANG SURABAYA 1)'
WHERE accurate_warehouse_id IN (100, 2250) AND warehouse_kode = 'SBY';
