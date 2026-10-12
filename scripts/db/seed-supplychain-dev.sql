-- seed-supplychain-dev.sql — data SINTETIS modul rantai pasok (dev/demo, BUKAN prod).
-- Mengisi menu: /purchase-orders, /inbound-receiving, /supplier-eta,
-- /shipment-tracking, /inventory-relocations, /vendor-management.
-- Idempoten; uuid dummy '90000000-...'; tanggal RELATIF.
-- Nilai status mengikuti CHECK masing-masing tabel:
--   purchase_order.lini            IVD|Medical
--   inbound_receiving.status       in_progress|completed
--   supplier_eta.status            pending|arrived|cancelled
--   shipment_tracking.status       draft|dikirim|terima|bast
--   inventory_relocation_request   pending|completed|cancelled (cabang_asal <> cabang_tujuan)

BEGIN;

-- ── Vendor / mitra ──
INSERT INTO vendor_partner (id, name, category, contact_person, phone, email, cabang, is_active, notes) VALUES
  ('90000000-0000-0000-0000-000000110001', 'PT Reagen Sejahtera Demo',  'Reagen',       'Pak Hendra Demo', '628000000201', 'sales@reagendemo.test',  'SURABAYA', TRUE, 'Supplier reagen hematologi'),
  ('90000000-0000-0000-0000-000000110002', 'PT Alat Lab Prima Demo',    'Alat',         'Bu Sinta Demo',   '628000000202', 'info@alatlabdemo.test',  'SURABAYA', TRUE, NULL),
  ('90000000-0000-0000-0000-000000110003', 'CV Logistik Cepat Demo',    'Ekspedisi',    'Pak Bagas Demo',  '628000000203', NULL,                     'SURABAYA', TRUE, 'Ekspedisi Jawa-Bali'),
  ('90000000-0000-0000-0000-000000110004', 'PT Servis Kalibrasi Demo',  'Jasa Teknik',  'Pak Wawan Demo',  '628000000204', NULL,                     'MALANG',   TRUE, 'Kalibrasi tahunan'),
  ('90000000-0000-0000-0000-000000110005', 'PT Kemasan Medis Demo',     'Consumable',   'Bu Ayu Demo',     '628000000205', NULL,                     'SURABAYA', FALSE,'Nonaktif sejak kontrak habis')
ON CONFLICT (id) DO NOTHING;

-- ── Purchase order + itemnya ──
INSERT INTO purchase_order (id, po_number, vendor_name, order_date, eta_date, cabang, pic, lini, notes, created_by) VALUES
  ('90000000-0000-0000-0000-000000120001', 'PO-DEMO-2601', 'PT Reagen Sejahtera Demo', CURRENT_DATE - 24, CURRENT_DATE - 10, 'SURABAYA', 'Irfan Demo', 'IVD',     'Restock reagen hematologi', 'Irfan Demo'),
  ('90000000-0000-0000-0000-000000120002', 'PO-DEMO-2602', 'PT Alat Lab Prima Demo',   CURRENT_DATE - 18, CURRENT_DATE - 2,  'SURABAYA', 'Irfan Demo', 'Medical', NULL,                        'Irfan Demo'),
  ('90000000-0000-0000-0000-000000120003', 'PO-DEMO-2603', 'PT Reagen Sejahtera Demo', CURRENT_DATE - 9,  CURRENT_DATE + 5,  'MALANG',   'Irfan Demo', 'IVD',     'Untuk KSO RSUD Demo Sehat', 'Irfan Demo'),
  ('90000000-0000-0000-0000-000000120004', 'PO-DEMO-2604', 'PT Servis Kalibrasi Demo', CURRENT_DATE - 4,  CURRENT_DATE + 12, 'SURABAYA', 'Hana Demo',  'Medical', 'Kalibrasi 4 alat',          'Hana Demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_item (id, purchase_order_id, item_desc, qty_ordered, unit, unit_price, notes) VALUES
  ('90000000-0000-0000-0000-000000130001', '90000000-0000-0000-0000-000000120001', 'Reagen Diluent 20L',        10, 'jerigen', 1850000, NULL),
  ('90000000-0000-0000-0000-000000130002', '90000000-0000-0000-0000-000000120001', 'Reagen Lyse 1L',            24, 'botol',   420000,  NULL),
  ('90000000-0000-0000-0000-000000130003', '90000000-0000-0000-0000-000000120002', 'Mikropipet 100-1000uL',      4, 'unit',    2750000, 'Bergaransi 1 tahun'),
  ('90000000-0000-0000-0000-000000130004', '90000000-0000-0000-0000-000000120003', 'Kontrol Hematologi 3 level', 6, 'set',     3100000, NULL),
  ('90000000-0000-0000-0000-000000130005', '90000000-0000-0000-0000-000000120004', 'Jasa kalibrasi analyzer',    4, 'unit',    1500000, 'Termasuk sertifikat')
ON CONFLICT (id) DO NOTHING;

-- ── ETA supplier (satu lewat jadwal, satu sudah datang) ──
INSERT INTO supplier_eta (id, vendor_name, po_number, item_desc, qty, eta_date, status, actual_arrival_date, cabang, notes, created_by) VALUES
  ('90000000-0000-0000-0000-000000140001', 'PT Reagen Sejahtera Demo', 'PO-DEMO-2601', 'Reagen Diluent 20L',        10, CURRENT_DATE - 10, 'arrived', CURRENT_DATE - 9, 'SURABAYA', NULL,                          'Irfan Demo'),
  ('90000000-0000-0000-0000-000000140002', 'PT Alat Lab Prima Demo',   'PO-DEMO-2602', 'Mikropipet 100-1000uL',      4, CURRENT_DATE - 2,  'pending', NULL,             'SURABAYA', 'Ditanyakan ke vendor, mundur','Irfan Demo'),
  ('90000000-0000-0000-0000-000000140003', 'PT Reagen Sejahtera Demo', 'PO-DEMO-2603', 'Kontrol Hematologi 3 level', 6, CURRENT_DATE + 5,  'pending', NULL,             'MALANG',   NULL,                          'Irfan Demo'),
  ('90000000-0000-0000-0000-000000140004', 'PT Kemasan Medis Demo',    NULL,           'Box pendingin reagen',      20, CURRENT_DATE - 6,  'cancelled', NULL,           'SURABAYA', 'Dibatalkan, ganti supplier',  'Irfan Demo')
ON CONFLICT (id) DO NOTHING;

-- ── Inbound receiving (checklist penerimaan barang) ──
INSERT INTO inbound_receiving (id, vendor_name, po_number, received_date, cabang, received_by, status, overall_notes, completed_at, created_by) VALUES
  ('90000000-0000-0000-0000-000000150001', 'PT Reagen Sejahtera Demo', 'PO-DEMO-2601', CURRENT_DATE - 9, 'SURABAYA', 'Krisna Demo', 'completed',   'Semua sesuai, segel utuh', now() - interval '9 days', 'Krisna Demo'),
  ('90000000-0000-0000-0000-000000150002', 'PT Alat Lab Prima Demo',   'PO-DEMO-2602', CURRENT_DATE - 1, 'SURABAYA', 'Krisna Demo', 'in_progress', 'Menunggu cek kelengkapan aksesori', NULL,          'Krisna Demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inbound_receiving_item (id, receiving_id, label, is_checked, notes, sort_order) VALUES
  ('90000000-0000-0000-0000-000000160001', '90000000-0000-0000-0000-000000150001', 'Jumlah koli sesuai surat jalan', TRUE,  NULL,                    1),
  ('90000000-0000-0000-0000-000000160002', '90000000-0000-0000-0000-000000150001', 'Segel kemasan utuh',             TRUE,  NULL,                    2),
  ('90000000-0000-0000-0000-000000160003', '90000000-0000-0000-0000-000000150001', 'Tanggal kedaluwarsa > 12 bulan', TRUE,  'ED 2028',               3),
  ('90000000-0000-0000-0000-000000160004', '90000000-0000-0000-0000-000000150002', 'Fisik unit tanpa lecet',         TRUE,  NULL,                    1),
  ('90000000-0000-0000-0000-000000160005', '90000000-0000-0000-0000-000000150002', 'Aksesori lengkap (tip, rak)', FALSE, 'Rak tip belum ada',  2)
ON CONFLICT (id) DO NOTHING;

-- ── Tracking pengiriman (satu per tahap status) ──
INSERT INTO shipment_tracking (id, sj_number, customer_name, cabang, distance_km, eta_days, driver_name, driver_wa_number, status,
                               kirim_at, kirim_by, terima_at, terima_by, bast_at, bast_by, created_by) VALUES
  ('90000000-0000-0000-0000-000000170001', 'SJ-DEMO-0101', 'RS Umum Daerah Demo Sehat', 'SURABAYA', 32,  1, 'Pak Sugeng Demo', '628000000301', 'bast',    now() - interval '8 days', 'Krisna Demo', now() - interval '7 days', 'Petugas Lab Demo', now() - interval '5 days', 'Andi Demo', 'Krisna Demo'),
  ('90000000-0000-0000-0000-000000170002', 'SJ-DEMO-0102', 'RS Islam Demo Husada',      'SURABAYA', 78,  1, 'Pak Sugeng Demo', '628000000301', 'terima',  now() - interval '3 days', 'Krisna Demo', now() - interval '2 days', 'Petugas Lab Demo', NULL,                      NULL,        'Krisna Demo'),
  ('90000000-0000-0000-0000-000000170003', 'SJ-DEMO-0103', 'Klinik Pratama Demo Jaya',  'MALANG',   145, 2, 'Pak Rudi Demo',   '628000000302', 'dikirim', now() - interval '1 day',  'Krisna Demo', NULL,                      NULL,                NULL,                      NULL,        'Krisna Demo'),
  ('90000000-0000-0000-0000-000000170004', 'SJ-DEMO-0104', 'RS Umum Daerah Demo Sehat', 'SURABAYA', 32,  1, NULL,              NULL,           'draft',   NULL,                      NULL,          NULL,                      NULL,                NULL,                      NULL,        'Krisna Demo')
ON CONFLICT (id) DO NOTHING;

-- ── Relokasi stok antar cabang ──
INSERT INTO inventory_relocation_request (id, item_desc, qty, unit, cabang_asal, cabang_tujuan, reason, requested_by, request_date, status, completed_at, notes) VALUES
  ('90000000-0000-0000-0000-000000180001', 'Reagen Diluent 20L',        3, 'jerigen', 'SURABAYA', 'MALANG',   'Stok Malang habis, pasien menunggu', 'Bunga Demo', CURRENT_DATE - 6, 'completed', now() - interval '4 days', NULL),
  ('90000000-0000-0000-0000-000000180002', 'Kontrol Hematologi 3 level',1, 'set',     'SURABAYA', 'JEMBER',   'Kalibrasi bulanan',                  'Lina Demo',  CURRENT_DATE - 2, 'pending',   NULL,                      'Menunggu jadwal kurir'),
  ('90000000-0000-0000-0000-000000180003', 'Mikropipet 100-1000uL',     2, 'unit',    'MALANG',   'SURABAYA', 'Dipakai training internal',          'Galih Demo', CURRENT_DATE - 9, 'cancelled', NULL,                      'Dibatalkan, unit dipakai di tempat')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed rantai pasok selesai: 5 vendor, 4 PO + 5 item, 4 ETA, 2 receiving + 5 checklist, 4 tracking, 3 relokasi.'
