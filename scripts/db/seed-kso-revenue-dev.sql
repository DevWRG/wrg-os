-- seed-kso-revenue-dev.sql — data SINTETIS modul KSO + revenue stream
-- (dev/demo, BUKAN prod). Mengisi menu: /kso-simulator, /kso-produktivitas,
-- /revenue-stream.
--
-- Rantai yang dihormati:
--   kso_analyzer(id) → kso_reagent(analyzer_id)          [master simulator]
--   kso_panel(grup,nama) + kso_parameter(grup,no)        [master simulator]
--   accurate_customer → kso_asset(account_id) → kso_asset_test_monthly(asset_id,periode)
--   kso_asset.skema HARUS ada di kso_kategori_skema (BELI_REAGEN|PER_TEST) — 6 baris
--   itu sudah diseed migrasi.
--
-- Nilai enum yang WAJIB dipatuhi (CHECK, bukan sekadar konvensi):
--   kso_analyzer.kategori  HEMATO|CC|XM|CLIA|HPLC|ELEKTRO|BG
--   kso_parameter.grup     CC|SNIBE|WONDFO   (jadi parameter hematologi tak punya grup sendiri)
--   kso_reagent.jenis      reagent|consumable|cartridge|qc
--   kso_asset.pemilik_alat WRG|PRINCIPAL|CUSTOMER · skema PER_TEST|BELI_REAGEN|UNKNOWN
--
-- /revenue-stream membaca accurate_invoice_item lalu
--   LEFT JOIN product_code pc ON pc.accurate_item_id = ii.item_id
-- jadi kode produk demo WAJIB ditautkan ke accurate_item demo (900001…), kalau
-- tidak semua omzet jatuh ke stream "tak terpetakan" dan halaman tampak kosong.

BEGIN;

-- ── Tautkan kode produk demo ke item Accurate demo (untuk revenue stream) ──
UPDATE product_code SET accurate_item_id = 900001 WHERE kode = '01.01.01.001.0001' AND accurate_item_id IS NULL;
UPDATE product_code SET accurate_item_id = 900002 WHERE kode = '01.01.01.002.0001' AND accurate_item_id IS NULL;
UPDATE product_code SET accurate_item_id = 900003 WHERE kode = '01.02.02.001.0001' AND accurate_item_id IS NULL;
UPDATE product_code SET accurate_item_id = 900004 WHERE kode = '01.02.02.002.0001' AND accurate_item_id IS NULL;
UPDATE product_code SET accurate_item_id = 900005 WHERE kode = '02.01.01.001.0001' AND accurate_item_id IS NULL;
UPDATE product_code SET accurate_item_id = 900006 WHERE kode = '02.01.01.002.0001' AND accurate_item_id IS NULL;

-- ── Master simulator KSO: analyzer + reagen ──
INSERT INTO kso_analyzer (id, kategori, kode, label, brand, default_capex, default_capex_pl, default_disc,
                          default_kso_bulan, default_markup, default_tests, aktif, urutan) VALUES
  (900001, 'HEMATO', 'HEMA3-DEMO', 'Analyzer Hematologi 3-diff Demo', 'BrandDemo A', 132000000, 185000000, 0.10, 36, 0.35, 1500, TRUE, 1),
  (900002, 'HEMATO', 'HEMA5-DEMO', 'Analyzer Hematologi 5-diff Demo', 'BrandDemo A', 240000000, 325000000, 0.12, 48, 0.35, 2500, TRUE, 2),
  (900003, 'CC',     'KIMIA-DEMO', 'Chemistry Analyzer 200T Demo',    'BrandDemo B', 198000000, 275000000, 0.10, 36, 0.30, 3000, TRUE, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO kso_reagent (id, analyzer_id, kode, jenis, nama, pack, vol, yield_test, harga_dp, harga_pl, urutan) VALUES
  (900001, 900001, 'DIL-DEMO',  'reagent',    'Diluent 20L Demo',        'jerigen', 20, 2000, 1420000, 2100000, 1),
  (900002, 900001, 'LYS-DEMO',  'reagent',    'Lyse 1L Demo',            'botol',    1,  400,  351000,  520000, 2),
  (900003, 900002, 'DIL5-DEMO', 'reagent',    'Diluent 5-diff 20L Demo', 'jerigen', 20, 1800, 1650000, 2350000, 1),
  (900004, 900002, 'CTL-DEMO',  'qc',         'Kontrol 3 Level Demo',    'set',      3,   90, 2450000, 3450000, 2),
  (900005, 900003, 'KIM-DEMO',  'reagent',    'Reagen Kimia Paket Demo', 'kit',      1,  400, 1980000, 2750000, 1),
  (900006, 900003, 'CUV-DEMO',  'consumable', 'Kuvet Reaksi Demo',       'pack',     1, 1000,  620000,  890000, 3)
ON CONFLICT (id) DO NOTHING;

-- ── Master simulator KSO: panel & parameter ──
INSERT INTO kso_panel (grup, nama, urutan) VALUES
  ('CC',    'Fungsi Hati Demo',   1),
  ('CC',    'Fungsi Ginjal Demo', 2),
  ('SNIBE', 'Imunologi Demo',     3)
ON CONFLICT (grup, nama) DO NOTHING;

INSERT INTO kso_parameter (id, grup, no, nama, panel, pack, tests_per_kit, harga_dp, harga_pl, aktif) VALUES
  (900001, 'CC',    1, 'SGOT Demo',      'Fungsi Hati Demo',   'kit', 200, 8500, 13000, TRUE),
  (900002, 'CC',    2, 'SGPT Demo',      'Fungsi Hati Demo',   'kit', 200, 8500, 13000, TRUE),
  (900003, 'CC',    3, 'Kreatinin Demo', 'Fungsi Ginjal Demo', 'kit', 200, 9200, 14000, TRUE),
  (900004, 'CC',    4, 'Ureum Demo',     'Fungsi Ginjal Demo', 'kit', 200, 9200, 14000, TRUE),
  (900005, 'SNIBE', 1, 'TSH Demo',       'Imunologi Demo',     'kit', 100, 21000, 32000, TRUE),
  (900006, 'SNIBE', 2, 'FT4 Demo',       'Imunologi Demo',     'kit', 100, 21000, 32000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Aset KSO terpasang di faskes demo ──
-- skema hanya boleh BELI_REAGEN / PER_TEST (lihat kso_kategori_skema).
INSERT INTO kso_asset (id, sn_key, sn_raw, customer_raw, account_id, kota, station, type_alat, nama_alat, skema,
                       pemilik_alat, nomor_mou, mou_berlaku_sampai, target_jumlah_tes, ritme_kunjungan, paket,
                       status_sheet, in_populasi, aktif) VALUES
  (900001, 'SN-DEMO-H5-001', 'SN-DEMO-H5-001', 'RS Umum Daerah Demo Sehat', 900001, 'Surabaya', 'Lab Sentral', 'Hematologi', 'Analyzer Hematologi 5-diff Demo', 'PER_TEST',    'WRG', 'MOU-DEMO-001', CURRENT_DATE + 540, 2500, 'Bulanan',   'Paket A Demo', 'AKTIF', TRUE, TRUE),
  (900002, 'SN-DEMO-H3-002', 'SN-DEMO-H3-002', 'RS Islam Demo Husada',      900002, 'Surabaya', 'Lab Rawat Jalan','Hematologi','Analyzer Hematologi 3-diff Demo', 'BELI_REAGEN', 'WRG', 'MOU-DEMO-002', CURRENT_DATE + 300, 1500, 'Bulanan',   'Paket B Demo', 'AKTIF', TRUE, TRUE),
  (900003, 'SN-DEMO-C2-003', 'SN-DEMO-C2-003', 'Klinik Pratama Demo Jaya',  900003, 'Malang',   'Lab Utama',   'Kimia',      'Chemistry Analyzer 200T Demo',    'PER_TEST',    'WRG', 'MOU-DEMO-003', CURRENT_DATE + 120, 3000, 'Dua bulanan','Paket A Demo', 'AKTIF', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Jumlah tes per bulan (6 bulan terakhir, relatif) ──
-- periode = tanggal awal bulan; angka dibuat naik-turun supaya tren terlihat.
INSERT INTO kso_asset_test_monthly (asset_id, periode, jumlah_tes, sumber_sheet)
SELECT a.asset_id,
       date_trunc('month', CURRENT_DATE - (m.n || ' months')::interval)::date,
       a.base + (m.n * a.step) + ((m.n * 37) % 120),
       'seed-demo'
FROM (VALUES (900001, 2100, -40), (900002, 1250, -25), (900003, 2600, -55)) AS a(asset_id, base, step)
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5)) AS m(n)
ON CONFLICT (asset_id, periode) DO NOTHING;

-- ── Invoice bertanggal RELATIF (bulan berjalan + 2 bulan lalu) ──
-- seed-dev-full.sql memberi 10 invoice bertanggal HARDCODE (Jun–Jul 2026),
-- sementara /reports/revenue-by-stream default ke BULAN BERJALAN (streamRange()).
-- Tanpa invoice bulan ini, /revenue-stream selalu kosong walau data lain lengkap.
-- Barisnya menautkan item 900001–900006 supaya join ke product_code menghasilkan
-- stream (bukan jatuh ke "tanpa klasifikasi").
INSERT INTO accurate_invoice (id, number, customer_id, branch_id, tanggal, taxable_amount, tax_amount, total, paid, outstanding, status, salesman_name)
SELECT v.id, v.number, v.cust, 900001, v.tgl, v.dpp, round(v.dpp * 0.11), round(v.dpp * 1.11), v.paid, round(v.dpp * 1.11) - v.paid, v.status, v.sales
FROM (VALUES
  -- Tanggal dihitung MUNDUR dari hari ini, bukan maju dari awal bulan: rentang
  -- default streamRange() adalah awal-bulan..HARI INI, jadi tanggal maju (mis.
  -- tgl 5 saat hari ini tgl 2) jatuh di luar rentang dan halaman tetap kosong.
  (900011, 'INV-DEMO-0011', 900001, CURRENT_DATE,      166500000::numeric, 100000000::numeric, 'unpaid', 'Andi Pratama Demo'),
  (900012, 'INV-DEMO-0012', 900002, CURRENT_DATE,       26220000::numeric,  29104200::numeric, 'paid',   'Bunga Lestari Demo'),
  (900013, 'INV-DEMO-0013', 900003, CURRENT_DATE - 1,    3570000::numeric,          0::numeric, 'unpaid', 'Candra Wijaya Demo'),
  (900014, 'INV-DEMO-0014', 900001, CURRENT_DATE - 20, 286000000::numeric, 317460000::numeric, 'paid',   'Andi Pratama Demo'),
  (900015, 'INV-DEMO-0015', 900002, CURRENT_DATE - 40,  13570000::numeric,          0::numeric, 'unpaid', 'Bunga Lestari Demo'),
  (900016, 'INV-DEMO-0016', 900003, CURRENT_DATE - 70,   1785000::numeric,   1981350::numeric, 'paid',   'Candra Wijaya Demo')
) AS v(id, number, cust, tgl, dpp, paid, status, sales)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_invoice_item (id, invoice_id, item_id, line_no, qty, unit, unit_price, discount_amount, total) VALUES
  (900011, 900011, 900002, 1, 1,  'unit',    286000000, 119500000, 166500000),
  (900012, 900012, 900005, 1, 1,  'unit',     26220000,         0,  26220000),
  (900013, 900013, 900003, 1, 2,  'jerigen',   1785000,         0,   3570000),
  (900014, 900014, 900002, 1, 1,  'unit',    286000000,         0, 286000000),
  (900015, 900015, 900006, 1, 1,  'unit',     13570000,         0,  13570000),
  (900016, 900016, 900003, 1, 1,  'jerigen',   1785000,         0,   1785000),
  (900017, 900011, 900004, 2, 5,  'botol',      442000,         0,   2210000),
  (900018, 900014, 900001, 2, 1,  'unit',    166500000,         0, 166500000)
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed KSO & revenue selesai: 3 analyzer, 6 reagen, 3 panel, 6 parameter, 3 aset KSO, 18 baris tes bulanan, 6 kode produk ditautkan ke item Accurate, 6 invoice + 8 baris item bertanggal relatif.'
