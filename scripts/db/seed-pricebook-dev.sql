-- seed-pricebook-dev.sql — data SINTETIS master klasifikasi produk + pricebook
-- (dev/demo, BUKAN prod). Mengisi menu: /klasifikasi-produk, /pricebook/setup,
-- /pricebook, /pricebook/ringkasan.
--
-- Rantai kunci komposit yang harus dihormati urutannya:
--   product_kategori(id 2 digit)
--     → product_line(kategori_id, id 2 digit)
--     → product_class(kategori_id, id 2 digit)
--       → product_sub_class(kategori_id, class_id, id 3 digit)
--         → product_code(kode '^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{4}$' = kategori.line.class.subclass.seq)
--   product_pricelist(periode, row_no)  → product_pricelist_setup(periode, row_no)
--
-- periode WAJIB 'H2-2026': PERIODE_DEFAULT di apps/api/src/repo/pricebook.ts
-- masih hardcode ke nilai itu, jadi halaman hanya menemukan data pada periode ini.

BEGIN;

-- ── Lapis 1: kategori ──
INSERT INTO product_kategori (id, nama, aktif) VALUES
  ('01', 'IVD Demo',     TRUE),
  ('02', 'Medical Demo', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Lapis 2: line & class (dua-duanya anak kategori) ──
INSERT INTO product_line (kategori_id, id, nama, aktif) VALUES
  ('01', '01', 'Hematologi Demo',   TRUE),
  ('01', '02', 'Kimia Klinik Demo', TRUE),
  ('02', '01', 'Alat Medis Demo',   TRUE)
ON CONFLICT (kategori_id, id) DO NOTHING;

INSERT INTO product_class (kategori_id, id, nama, aktif) VALUES
  ('01', '01', 'Analyzer Demo', TRUE),
  ('01', '02', 'Reagen Demo',   TRUE),
  ('02', '01', 'Instrumen Demo',TRUE)
ON CONFLICT (kategori_id, id) DO NOTHING;

-- ── Lapis 3: sub-class ──
INSERT INTO product_sub_class (kategori_id, class_id, id, nama, aktif) VALUES
  ('01', '01', '001', 'Hematologi 3-diff Demo', TRUE),
  ('01', '01', '002', 'Hematologi 5-diff Demo', TRUE),
  ('01', '02', '001', 'Reagen Diluent Demo',    TRUE),
  ('01', '02', '002', 'Reagen Lyse Demo',       TRUE),
  ('02', '01', '001', 'Mikroskop Demo',         TRUE),
  ('02', '01', '002', 'Sentrifus Demo',         TRUE)
ON CONFLICT (kategori_id, class_id, id) DO NOTHING;

-- ── Lapis 4: kode produk ──
INSERT INTO product_code (kode, kategori_id, line_id, class_id, sub_class_id, seq, identitas, nama, nama_principal, kemasan, satuan, brand, penyedia, sumber, created_by) VALUES
  ('01.01.01.001.0001', '01', '01', '01', '001', 1, 'DEMO-IDT-0001', 'Analyzer Hematologi 3-diff Demo', 'Hema3 Demo',  'unit',   'unit', 'BrandDemo A', 'PT Alat Lab Prima Demo',   'seed-demo', 'seed-demo'),
  ('01.01.01.002.0001', '01', '01', '01', '002', 1, 'DEMO-IDT-0002', 'Analyzer Hematologi 5-diff Demo', 'Hema5 Demo',  'unit',   'unit', 'BrandDemo A', 'PT Alat Lab Prima Demo',   'seed-demo', 'seed-demo'),
  ('01.02.02.001.0001', '01', '02', '02', '001', 1, 'DEMO-IDT-0003', 'Reagen Diluent 20L Demo',        'Dil20 Demo',  'jerigen','L',    'BrandDemo B', 'PT Reagen Sejahtera Demo', 'seed-demo', 'seed-demo'),
  ('01.02.02.002.0001', '01', '02', '02', '002', 1, 'DEMO-IDT-0004', 'Reagen Lyse 1L Demo',            'Lyse1 Demo',  'botol',  'L',    'BrandDemo B', 'PT Reagen Sejahtera Demo', 'seed-demo', 'seed-demo'),
  ('02.01.01.001.0001', '02', '01', '01', '001', 1, 'DEMO-IDT-0005', 'Mikroskop Binokuler Demo',       'MikroB Demo', 'unit',   'unit', 'BrandDemo C', 'PT Alat Lab Prima Demo',   'seed-demo', 'seed-demo'),
  ('02.01.01.002.0001', '02', '01', '01', '002', 1, 'DEMO-IDT-0006', 'Sentrifus 12 Tabung Demo',       'Sentri Demo', 'unit',   'unit', 'BrandDemo C', 'PT Alat Lab Prima Demo',   'seed-demo', 'seed-demo')
ON CONFLICT (kode) DO NOTHING;

-- ── Pricelist mentah (periode H2-2026) ──
-- diskon_maks disimpan sebagai fraksi (0..1), harga_nett = price_list * (1 - diskon),
-- nett_ppn = harga_nett * 1,11.
INSERT INTO product_pricelist (periode, row_no, kode, lini, brand, nama, varian, kemasan, kategori, kategori_verified,
                               price_list, diskon_maks, harga_nett, nett_ppn, catatan) VALUES
  ('H2-2026', 1, '01.01.01.001.0001', 'IVD',     'BrandDemo A', 'Analyzer Hematologi 3-diff Demo', '3-diff', 'unit',    'Analyzer Demo', TRUE,  185000000, 0.10, 166500000, 184815000, NULL),
  ('H2-2026', 2, '01.01.01.002.0001', 'IVD',     'BrandDemo A', 'Analyzer Hematologi 5-diff Demo', '5-diff', 'unit',    'Analyzer Demo', TRUE,  325000000, 0.12, 286000000, 317460000, 'Termasuk instalasi'),
  ('H2-2026', 3, '01.02.02.001.0001', 'IVD',     'BrandDemo B', 'Reagen Diluent 20L Demo',         NULL,     'jerigen', 'Reagen Demo',   TRUE,    2100000, 0.15,   1785000,   1981350, NULL),
  ('H2-2026', 4, '01.02.02.002.0001', 'IVD',     'BrandDemo B', 'Reagen Lyse 1L Demo',             NULL,     'botol',   'Reagen Demo',   TRUE,     520000, 0.15,    442000,    490620, NULL),
  ('H2-2026', 5, '02.01.01.001.0001', 'Medical', 'BrandDemo C', 'Mikroskop Binokuler Demo',        NULL,     'unit',    'Instrumen Demo',TRUE,   28500000, 0.08,  26220000,  29104200, NULL),
  ('H2-2026', 6, '02.01.01.002.0001', 'Medical', 'BrandDemo C', 'Sentrifus 12 Tabung Demo',        NULL,     'unit',    'Instrumen Demo',FALSE,  14750000, 0.08,  13570000,  15062700, 'Kategori belum diverifikasi'),
  ('H2-2026', 7, NULL,                'Medical', 'BrandDemo C', 'Rak Tabung Reaksi Demo',          NULL,     'pcs',     NULL,            FALSE,    350000, 0.05,    332500,    369075, 'Belum punya kode produk'),
  ('H2-2026', 8, NULL,                'IVD',     'BrandDemo B', 'Kontrol Hematologi 3 Level Demo', NULL,     'set',     'Reagen Demo',   FALSE,   3450000, 0.10,   3105000,   3446550, 'Menunggu kroscek')
ON CONFLICT (periode, row_no) DO NOTHING;

-- ── Lapisan kroscek/setup: 6 published + 2 draft ──
INSERT INTO product_pricelist_setup (periode, row_no, nama_final, varian, kemasan, satuan, hpp,
                                     kategori_id, line_id, class_id, sub_class_id, product_kode, kode_sumber,
                                     kroscek_no, catatan, status, published_at, published_by, updated_by) VALUES
  ('H2-2026', 1, 'Analyzer Hematologi 3-diff Demo', '3-diff', 'unit',    'unit', 132000000, '01', '01', '01', '001', '01.01.01.001.0001', 'seed-demo', 1, NULL,                        'published', now() - interval '20 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 2, 'Analyzer Hematologi 5-diff Demo', '5-diff', 'unit',    'unit', 240000000, '01', '01', '01', '002', '01.01.01.002.0001', 'seed-demo', 2, NULL,                        'published', now() - interval '20 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 3, 'Reagen Diluent 20L Demo',         NULL,     'jerigen', 'L',      1420000, '01', '02', '02', '001', '01.02.02.001.0001', 'seed-demo', 3, NULL,                        'published', now() - interval '20 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 4, 'Reagen Lyse 1L Demo',             NULL,     'botol',   'L',       351000, '01', '02', '02', '002', '01.02.02.002.0001', 'seed-demo', 4, NULL,                        'published', now() - interval '20 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 5, 'Mikroskop Binokuler Demo',        NULL,     'unit',    'unit',  21500000, '02', '01', '01', '001', '02.01.01.001.0001', 'seed-demo', 5, NULL,                        'published', now() - interval '14 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 6, 'Sentrifus 12 Tabung Demo',        NULL,     'unit',    'unit',  11200000, '02', '01', '01', '002', '02.01.01.002.0001', 'seed-demo', 6, NULL,                        'published', now() - interval '14 days', 'Akun Demo', 'Akun Demo'),
  ('H2-2026', 7, 'Rak Tabung Reaksi Demo',          NULL,     'pcs',     'pcs',      240000, NULL, NULL, NULL, NULL, NULL,                'seed-demo', 7, 'Belum ada kode produk',     'draft',     NULL,                      NULL,         'Akun Demo'),
  ('H2-2026', 8, 'Kontrol Hematologi 3 Level Demo', NULL,     'set',     'set',     2450000, '01', '02', '02', '001', NULL,                'seed-demo', 8, 'Menunggu verifikasi kategori','draft',    NULL,                      NULL,         'Akun Demo')
ON CONFLICT (periode, row_no) DO NOTHING;

COMMIT;

\echo 'Seed pricebook selesai: 2 kategori, 3 line, 3 class, 6 sub-class, 6 kode, 8 pricelist, 8 setup (6 published + 2 draft).'
