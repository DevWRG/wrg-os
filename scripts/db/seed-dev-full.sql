-- seed-dev-full.sql — data SINTETIS untuk mengisi menu dashboard yang masih kosong
-- di DB lokal (dev/dummy, BUKAN prod). Konvensi ikut scripts/db/seed-dev.sql:
--   - Idempoten: ON CONFLICT DO NOTHING utk PK eksplisit, WHERE NOT EXISTS utk PK serial/identity.
--   - PK integer/bigint eksplisit >= 900000 (tak bentrok data lain).
--   - PK uuid eksplisit dummy pakai pola '90000000-0000-0000-0000-0000000000XX'.
--   - Kode/identifier text (no Accurate, group_jid, dst) prefix 'DEMO-'.
--   - am_id REUSE demo1/demo2/demo3 (dari master_user, lihat seed-dev.sql).
--   - hod_key REUSE key nyata dari HOD_CONFIG (apps/api/src/repo/watchpoint.ts):
--     rocky (Sales East), yogi (Sales West), mufid (Business IVD), arman (Business
--     Medical & HD), pakMuhid (Aftersales), ika (Finance & SC), fafa (Accounting & Tax),
--     husni (BD & GA).
--
--   docker compose exec -T postgres psql -U wrg -d wrg_os -f - < scripts/db/seed-dev-full.sql
--
-- JANGAN edit scripts/db/seed-dev.sql (file lain, sudah ada & dipakai) — file ini
-- terpisah, khusus tabel yang masih 0 baris per audit 2026-07-28.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- ── Accurate mirror: Products/Inventory, Suppliers ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO accurate_branch (id, name, suspended, raw) VALUES
  (900001, 'Surabaya Pusat', FALSE, '{"demo":true}'::jsonb),
  (900002, 'Jakarta',        FALSE, '{"demo":true}'::jsonb),
  (900003, 'Malang',         FALSE, '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_item (id, no, name, category, unit_price, quantity, available, unit, raw) VALUES
  (900001, 'DEMO-ITM-0001', 'Reagen Hematologi Analyzer 5-Diff', 'Reagen',        1250000.00, 320.00, 300.00, 'BOX',  '{"demo":true}'::jsonb),
  (900002, 'DEMO-ITM-0002', 'Jarum Suntik Disposable 3cc',       'Alkes Habis Pakai', 45000.00, 5000.00, 4800.00, 'BOX', '{"demo":true}'::jsonb),
  (900003, 'DEMO-ITM-0003', 'Kateter Urine Foley 16Fr',          'Alkes Habis Pakai', 32000.00, 1200.00, 1100.00, 'PCS', '{"demo":true}'::jsonb),
  (900004, 'DEMO-ITM-0004', 'Tabung Vacutainer EDTA 3ml',        'Consumables Lab',  180000.00, 900.00, 850.00, 'BOX',  '{"demo":true}'::jsonb),
  (900005, 'DEMO-ITM-0005', 'Infus Set Makro',                   'Alkes Habis Pakai',  15000.00, 3000.00, 2900.00, 'PCS', '{"demo":true}'::jsonb),
  (900006, 'DEMO-ITM-0006', 'Sarung Tangan Latex Non-Powder M',  'Alkes Habis Pakai',  85000.00, 2500.00, 2400.00, 'BOX', '{"demo":true}'::jsonb),
  (900007, 'DEMO-ITM-0007', 'Strip Test Glukosa',                'Reagen',            210000.00, 600.00, 560.00, 'BOX',  '{"demo":true}'::jsonb),
  (900008, 'DEMO-ITM-0008', 'Alkohol Swab 70%',                  'Alkes Habis Pakai',  38000.00, 4000.00, 3900.00, 'BOX', '{"demo":true}'::jsonb),
  (900009, 'DEMO-ITM-0009', 'Masker Bedah 3-Ply',                'Alkes Habis Pakai',  42000.00, 6000.00, 5800.00, 'BOX', '{"demo":true}'::jsonb),
  (900010, 'DEMO-ITM-0010', 'Reagen Kimia Klinik Elektrolit',    'Reagen',           980000.00, 150.00, 140.00, 'BOX',  '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_customer (id, no, name, branch_id, raw) VALUES
  (900001, 'DEMO-CUST-0001', 'RS Umum Daerah Demo Sehat',        900001, '{"demo":true}'::jsonb),
  (900002, 'DEMO-CUST-0002', 'RS Islam Demo Husada',             900001, '{"demo":true}'::jsonb),
  (900003, 'DEMO-CUST-0003', 'Klinik Pratama Demo Jaya',         900001, '{"demo":true}'::jsonb),
  (900004, 'DEMO-CUST-0004', 'Laboratorium Klinik Demo Prima',   900001, '{"demo":true}'::jsonb),
  (900005, 'DEMO-CUST-0005', 'RS Bhayangkara Demo',              900002, '{"demo":true}'::jsonb),
  (900006, 'DEMO-CUST-0006', 'Klinik Utama Demo Medika',         900002, '{"demo":true}'::jsonb),
  (900007, 'DEMO-CUST-0007', 'RS Panti Nirmala Demo',            900003, '{"demo":true}'::jsonb),
  (900008, 'DEMO-CUST-0008', 'Puskesmas Demo Wonokromo',         900001, '{"demo":true}'::jsonb),
  (900009, 'DEMO-CUST-0009', 'RS Siti Khodijah Demo Sepanjang',  900001, '{"demo":true}'::jsonb),
  (900010, 'DEMO-CUST-0010', 'Apotek & Klinik Demo Farma Sehat', 900003, '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_vendor (id, name, branch_name, raw) VALUES
  (900001, 'PT Demo Enseval Putera Megatrading', 'Surabaya Pusat', '{"demo":true}'::jsonb),
  (900002, 'PT Demo Mensa Bina Sukses',          'Jakarta',        '{"demo":true}'::jsonb),
  (900003, 'PT Demo Dipa Pharmalab Intersains',  'Surabaya Pusat', '{"demo":true}'::jsonb),
  (900004, 'PT Demo Kimia Farma Trading',        'Jakarta',        '{"demo":true}'::jsonb),
  (900005, 'PT Demo Bio Farma Distribusi',       'Malang',         '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Accurate sales: invoice, invoice item, salesman, target branch/area ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO accurate_salesman (id, name, number, branch_id, suspended, employee_work_status, master_user_id, cabang_override, raw, last_synced_at) VALUES
  (900001, 'Budi Demo (AM)', 'SLM-DEMO-01', 900001, FALSE, 'active', NULL, 'Demo', '{"demo":true}'::jsonb, NOW()),
  (900002, 'Sari Demo (AM)', 'SLM-DEMO-02', 900002, FALSE, 'active', NULL, 'Demo', '{"demo":true}'::jsonb, NOW()),
  (900003, 'Andi Demo (HOD)', 'SLM-DEMO-03', 900003, FALSE, 'active', NULL, 'Demo', '{"demo":true}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_invoice (id, number, customer_id, branch_id, tanggal, taxable_amount, tax_amount, total, paid, outstanding, status, salesman_id, salesman_name, raw, last_synced_at) VALUES
  (900001, 'DEMO-INV/2026/06/0001', 900001, 900001, '2026-06-05', 15000000, 1650000, 16650000, 16650000, 0,       'Lunas',       900001, 'Budi Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900002, 'DEMO-INV/2026/06/0002', 900002, 900001, '2026-06-12', 8200000,  902000,  9102000,  9102000,  0,       'Lunas',       900001, 'Budi Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900003, 'DEMO-INV/2026/06/0003', 900003, 900001, '2026-06-20', 3200000,  352000,  3552000,  0,        3552000, 'Belum Lunas', 900002, 'Sari Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900004, 'DEMO-INV/2026/07/0001', 900004, 900002, '2026-07-02', 22000000, 2420000, 24420000, 10000000, 14420000,'Sebagian',    900002, 'Sari Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900005, 'DEMO-INV/2026/07/0002', 900005, 900002, '2026-07-08', 5400000,  594000,  5994000,  5994000,  0,       'Lunas',       900003, 'Andi Demo (HOD)', '{"demo":true}'::jsonb, NOW()),
  (900006, 'DEMO-INV/2026/07/0003', 900006, 900002, '2026-07-14', 9800000,  1078000, 10878000, 0,        10878000,'Belum Lunas', 900001, 'Budi Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900007, 'DEMO-INV/2026/07/0004', 900007, 900003, '2026-07-18', 4100000,  451000,  4551000,  4551000,  0,       'Lunas',       900003, 'Andi Demo (HOD)', '{"demo":true}'::jsonb, NOW()),
  (900008, 'DEMO-INV/2026/07/0005', 900008, 900001, '2026-07-21', 1800000,  198000,  1998000,  0,        1998000, 'Belum Lunas', 900002, 'Sari Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900009, 'DEMO-INV/2026/07/0006', 900009, 900001, '2026-07-24', 6700000,  737000,  7437000,  3000000,  4437000, 'Sebagian',    900001, 'Budi Demo (AM)', '{"demo":true}'::jsonb, NOW()),
  (900010,'DEMO-INV/2026/07/0007', 900010, 900003, '2026-07-27', 12500000, 1375000, 13875000, 13875000, 0,       'Lunas',       900003, 'Andi Demo (HOD)', '{"demo":true}'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_invoice_item (id, invoice_id, item_id, line_no, qty, unit, unit_price, discount_amount, total, raw) VALUES
  (900001, 900001, 900001, 1, 10, 'BOX', 1250000, 0, 12500000, '{"demo":true}'::jsonb),
  (900002, 900001, 900004, 2, 5,  'BOX', 500000,  0, 2500000,  '{"demo":true}'::jsonb),
  (900003, 900002, 900002, 1, 100,'BOX', 45000,   0, 4500000,  '{"demo":true}'::jsonb),
  (900004, 900002, 900007, 2, 17.6,'BOX',210000,  0, 3696000,  '{"demo":true}'::jsonb),
  (900005, 900003, 900003, 1, 100,'PCS', 32000,   0, 3200000,  '{"demo":true}'::jsonb),
  (900006, 900004, 900010, 1, 20, 'BOX', 980000,  0, 19600000, '{"demo":true}'::jsonb),
  (900007, 900004, 900006, 2, 28.2,'BOX',85000,   0, 2400000,  '{"demo":true}'::jsonb),
  (900008, 900005, 900005, 1, 360,'PCS', 15000,   0, 5400000,  '{"demo":true}'::jsonb),
  (900009, 900006, 900009, 1, 233.3,'BOX',42000,  0, 9800000,  '{"demo":true}'::jsonb),
  (900010, 900007, 900008, 1, 107.9,'BOX',38000,  0, 4100000,  '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT setval('accurate_invoice_item_id_seq', GREATEST((SELECT COALESCE(max(id),0) FROM accurate_invoice_item), 1));

INSERT INTO sales_target_branch (cabang, area, total_yearly, monthly, notes, updated_at) VALUES
  ('Surabaya Pusat', 'East', 1200000000, 100000000, 'Target demo cabang Surabaya', NOW()),
  ('Jakarta',        'West', 900000000,  75000000,  'Target demo cabang Jakarta',  NOW()),
  ('Malang',         'East', 600000000,  50000000,  'Target demo cabang Malang',   NOW())
ON CONFLICT (cabang) DO NOTHING;

INSERT INTO sales_target_area (area, yearly, monthly, weekly, daily, updated_at) VALUES
  ('East', 1800000000, 150000000, 37500000, 6250000, NOW()),
  ('West', 900000000,  75000000,  18750000, 3125000, NOW())
ON CONFLICT (area) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Accurate sales order & delivery order (Orders/Shipments) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900001, 'DEMO-SO/2026/07/0001', '2026-07-20', 'RS Umum Daerah Demo Sehat',      'Selesai', 16650000, '{"demo":true}'::jsonb),
  (900002, 'DEMO-SO/2026/07/0002', '2026-07-21', 'RS Islam Demo Husada',           'Selesai', 9102000,  '{"demo":true}'::jsonb),
  (900003, 'DEMO-SO/2026/07/0003', '2026-07-23', 'Klinik Pratama Demo Jaya',       'Proses',  3552000,  '{"demo":true}'::jsonb),
  (900004, 'DEMO-SO/2026/07/0004', '2026-07-24', 'Laboratorium Klinik Demo Prima', 'Proses',  24420000, '{"demo":true}'::jsonb),
  (900005, 'DEMO-SO/2026/07/0005', '2026-07-26', 'RS Bhayangkara Demo',            'Draft',   5994000,  '{"demo":true}'::jsonb),
  (900006, 'DEMO-SO/2026/07/0006', '2026-07-27', 'Klinik Utama Demo Medika',       'Draft',   10878000, '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900001, 'DEMO-DO/2026/07/0001', '2026-07-21', 'RS Umum Daerah Demo Sehat',      'RS Umum Daerah Demo Sehat, Surabaya', 'Terkirim', '{"demo":true}'::jsonb),
  (900002, 'DEMO-DO/2026/07/0002', '2026-07-22', 'RS Islam Demo Husada',           'RS Islam Demo Husada, Surabaya',      'Terkirim', '{"demo":true}'::jsonb),
  (900003, 'DEMO-DO/2026/07/0003', '2026-07-24', 'Klinik Pratama Demo Jaya',       'Klinik Pratama Demo Jaya, Surabaya',  'Proses',   '{"demo":true}'::jsonb),
  (900004, 'DEMO-DO/2026/07/0004', '2026-07-25', 'Laboratorium Klinik Demo Prima', 'Lab Demo Prima, Jakarta',             'Proses',   '{"demo":true}'::jsonb),
  (900005, 'DEMO-DO/2026/07/0005', '2026-07-27', 'RS Bhayangkara Demo',            'RS Bhayangkara Demo, Jakarta',        'Draft',    '{"demo":true}'::jsonb),
  (900006, 'DEMO-DO/2026/07/0006', '2026-07-28', 'Klinik Utama Demo Medika',       'Klinik Utama Demo Medika, Jakarta',   'Draft',    '{"demo":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Accurate sync state, webhook log ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary) VALUES
  ('customer',       NOW(), TRUE, '{"demo":true,"count":10}'::jsonb),
  ('item',           NOW(), TRUE, '{"demo":true,"count":10}'::jsonb),
  ('vendor',         NOW(), TRUE, '{"demo":true,"count":5}'::jsonb),
  ('invoice',        NOW(), TRUE, '{"demo":true,"count":10}'::jsonb),
  ('sales_order',    NOW(), TRUE, '{"demo":true,"count":6}'::jsonb),
  ('delivery_order', NOW(), TRUE, '{"demo":true,"count":6}'::jsonb)
ON CONFLICT (entity) DO NOTHING;

INSERT INTO accurate_webhook_log (event_type, payload, input_hash, processed, received_at)
SELECT * FROM (VALUES
  ('invoice.created', '{"demo":true,"id":900001}'::jsonb, 'demo-hash-0001', TRUE,  NOW() - INTERVAL '3 day'),
  ('invoice.updated', '{"demo":true,"id":900004}'::jsonb, 'demo-hash-0002', TRUE,  NOW() - INTERVAL '2 day'),
  ('sales_order.created', '{"demo":true,"id":900006}'::jsonb, 'demo-hash-0003', FALSE, NOW() - INTERVAL '1 day')
) AS v(event_type, payload, input_hash, processed, received_at)
WHERE NOT EXISTS (SELECT 1 FROM accurate_webhook_log WHERE input_hash = v.input_hash);

-- ════════════════════════════════════════════════════════════════════
-- ── Finance & AR (ar_aging_mv, collection_draft) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO ar_aging_mv (customer_id, customer_name, invoice_no, due_date, amount, days_overdue, bucket, is_anomaly, refreshed_at) VALUES
  ('900003', 'Klinik Pratama Demo Jaya',       'DEMO-INV/2026/06/0003', '2026-07-05', 3552000,  23, '1-30',  FALSE, NOW()),
  ('900004', 'Laboratorium Klinik Demo Prima', 'DEMO-INV/2026/07/0001', '2026-07-17', 14420000, 11, '1-30',  FALSE, NOW()),
  ('900006', 'Klinik Utama Demo Medika',       'DEMO-INV/2026/07/0003', '2026-07-29', 10878000, 0,  'current', FALSE, NOW()),
  ('900008', 'Puskesmas Demo Wonokromo',       'DEMO-INV/2026/07/0005', '2026-06-15', 1998000,  43, '31-60', FALSE, NOW()),
  ('900009', 'RS Siti Khodijah Demo Sepanjang','DEMO-INV/2026/07/0006', '2026-05-01', 4437000,  88, '61-90', TRUE,  NOW())
ON CONFLICT (customer_id, invoice_no) DO NOTHING;

INSERT INTO collection_draft (customer_id, invoice_no, draft_text, draft_type, status, generated_by, approved_by, created_at)
SELECT * FROM (VALUES
  ('900008', 'DEMO-INV/2026/07/0005', 'Yth. Puskesmas Demo Wonokromo, mengingatkan invoice DEMO-INV/2026/07/0005 sebesar Rp1.998.000 telah lewat jatuh tempo 43 hari. Mohon konfirmasi jadwal pembayaran.', 'whatsapp', 'draft', 'A3', NULL, NOW() - INTERVAL '2 day'),
  ('900009', 'DEMO-INV/2026/07/0006', 'Yth. RS Siti Khodijah Demo Sepanjang, invoice DEMO-INV/2026/07/0006 sebesar Rp4.437.000 telah lewat jatuh tempo 88 hari. Mohon segera diproses pembayarannya.', 'email', 'approved', 'A3', 'development.wrg@gmail.com', NOW() - INTERVAL '1 day')
) AS v(customer_id, invoice_no, draft_text, draft_type, status, generated_by, approved_by, created_at)
WHERE NOT EXISTS (SELECT 1 FROM collection_draft WHERE customer_id = v.customer_id AND invoice_no = v.invoice_no);

-- ════════════════════════════════════════════════════════════════════
-- ── Sales CRM (deal / SPT pipeline, target, sps, doc, coaching) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO deal (
  deal_id, customer_id, customer_name, am_id, stage, estimated_value, product_ids, notes,
  prospect_category, probability, forecast_category, product_category, brand, product, parameter,
  facility_name, instansi_type, city, province, account_id, pic_hod, cabang,
  coop_model, qty_text, qty_num, qty_unit, estimate_amount, unit_price, purchase_month, purchase_year,
  on_hold, created_at, updated_at
) VALUES
  ('90000000-0000-0000-0000-000000000001', NULL, 'RS Umum Daerah Demo Sehat', 'demo1', 'Negotiation', 45000000, '[900001,900004]'::jsonb,
   'Nego harga reagen hematologi, target closing Agustus', 'Hot', 0.700, 'B Best', 'IVD', 'Demo-Brand A', 'Hematologi Analyzer', 'CBC 5-Diff',
   'RS Umum Daerah Demo Sehat', 'RS', 'Surabaya', 'Jawa Timur', 900001, 'rocky', 'Surabaya Pusat',
   'Sale', '20 box/bln', 20, 'box', 45000000, 1250000, 8, 2026, FALSE, NOW() - INTERVAL '20 day', NOW() - INTERVAL '1 day'),
  ('90000000-0000-0000-0000-000000000002', NULL, 'Klinik Pratama Demo Jaya', 'demo1', 'Quotation', 8500000, '[900003]'::jsonb,
   'Penawaran kateter untuk klinik baru', 'Warm', 0.400, 'C Pipeline', 'Medical', 'Demo-Brand B', 'Kateter Urine', 'Foley 16Fr',
   'Klinik Pratama Demo Jaya', 'Klinik', 'Surabaya', 'Jawa Timur', 900003, 'rocky', 'Surabaya Pusat',
   'Sale', '200 pcs', 200, 'pcs', 8500000, 32000, 8, 2026, FALSE, NOW() - INTERVAL '10 day', NOW() - INTERVAL '2 day'),
  ('90000000-0000-0000-0000-000000000003', NULL, 'RS Bhayangkara Demo', 'demo2', 'Offering', 22000000, '[900010]'::jsonb,
   'Offering letter reagen elektrolit', 'Warm', 0.450, 'C Pipeline', 'IVD', 'Demo-Brand A', 'Reagen Elektrolit', 'Na/K/Cl',
   'RS Bhayangkara Demo', 'RS', 'Jakarta', 'DKI Jakarta', 900005, 'yogi', 'Jakarta',
   'Sale', '20 box/bln', 20, 'box', 22000000, 980000, 8, 2026, FALSE, NOW() - INTERVAL '15 day', NOW() - INTERVAL '3 day'),
  ('90000000-0000-0000-0000-000000000004', NULL, 'Laboratorium Klinik Demo Prima', 'demo2', 'Presentation', 15000000, '[900004]'::jsonb,
   'Presentasi produk tabung vacutainer ke lab baru', 'Warm', 0.300, 'C Pipeline', 'IVD', 'Demo-Brand C', 'Tabung Vacutainer', 'EDTA',
   'Laboratorium Klinik Demo Prima', 'Lab Mandiri', 'Jakarta', 'DKI Jakarta', 900004, 'yogi', 'Jakarta',
   'Sale', '80 box', 80, 'box', 15000000, 180000, 9, 2026, FALSE, NOW() - INTERVAL '7 day', NOW() - INTERVAL '1 day'),
  ('90000000-0000-0000-0000-000000000005', NULL, 'RS Panti Nirmala Demo', 'demo1', 'First Contact', 6000000, '[]'::jsonb,
   'Kontak awal, jajaki kebutuhan alkes rutin', 'Cold', 0.150, 'D Omit', 'Medical', NULL, NULL, NULL,
   'RS Panti Nirmala Demo', 'RS', 'Malang', 'Jawa Timur', 900007, 'rocky', 'Malang',
   'Sale', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NOW() - INTERVAL '4 day', NOW() - INTERVAL '4 day'),
  ('90000000-0000-0000-0000-000000000006', NULL, 'Klinik Utama Demo Medika', 'demo2', 'Closing-Won', 10878000, '[900009]'::jsonb,
   'Deal closing masker & consumables rutin bulanan', 'Hot', 1.000, 'Won', 'Medical', 'Demo-Brand B', 'Masker Bedah', '3-Ply',
   'Klinik Utama Demo Medika', 'Klinik', 'Jakarta', 'DKI Jakarta', 900006, 'yogi', 'Jakarta',
   'Sale', '233 box', 233, 'box', 9800000, 42000, 7, 2026, FALSE, NOW() - INTERVAL '30 day', NOW() - INTERVAL '5 day'),
  ('90000000-0000-0000-0000-000000000007', NULL, 'Puskesmas Demo Wonokromo', 'demo1', 'Closing-Lost', 4000000, '[]'::jsonb,
   'Kalah tender pengadaan alkes puskesmas',  'Cold', 0.000, 'Lost', 'Medical', NULL, NULL, NULL,
   'Puskesmas Demo Wonokromo', 'Puskesmas', 'Surabaya', 'Jawa Timur', 900008, 'rocky', 'Surabaya Pusat',
   'Sale', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NOW() - INTERVAL '40 day', NOW() - INTERVAL '10 day'),
  ('90000000-0000-0000-0000-000000000008', NULL, 'Apotek & Klinik Demo Farma Sehat', 'demo2', 'Prospecting', 3000000, '[]'::jsonb,
   'Prospek baru dari referral apotek', 'Cold', 0.100, 'D Omit', 'Medical', NULL, NULL, NULL,
   'Apotek & Klinik Demo Farma Sehat', 'Klinik', 'Malang', 'Jawa Timur', 900010, 'rocky', 'Malang',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NOW() - INTERVAL '2 day', NOW() - INTERVAL '2 day')
ON CONFLICT (deal_id) DO NOTHING;

UPDATE deal SET loss_reason = 'kalah-tender', loss_status = 'approved', loss_approved_by = 'development.wrg@gmail.com', loss_approved_at = NOW() - INTERVAL '9 day'
  WHERE deal_id = '90000000-0000-0000-0000-000000000007' AND loss_reason IS NULL;

INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason, occurred_at)
SELECT * FROM (VALUES
  ('90000000-0000-0000-0000-000000000001'::uuid, 'Offering', 'Negotiation', 'demo1', 'Customer minta nego harga', NOW() - INTERVAL '5 day'),
  ('90000000-0000-0000-0000-000000000006'::uuid, 'Negotiation', 'Closing-Won', 'demo2', 'PO diterima', NOW() - INTERVAL '5 day'),
  ('90000000-0000-0000-0000-000000000007'::uuid, 'Negotiation', 'Closing-Lost', 'demo1', 'Kalah tender', NOW() - INTERVAL '9 day')
) AS v(deal_id, from_stage, to_stage, changed_by, reason, occurred_at)
WHERE NOT EXISTS (
  SELECT 1 FROM spt_state_log s WHERE s.deal_id = v.deal_id AND s.to_stage = v.to_stage
);

INSERT INTO sales_target (am_id, period, target_revenue)
SELECT * FROM (VALUES
  ('demo1', '2026-07', 60000000::numeric),
  ('demo2', '2026-07', 50000000::numeric),
  ('demo3', '2026-07', 80000000::numeric)
) AS v(am_id, period, target_revenue)
WHERE NOT EXISTS (SELECT 1 FROM sales_target WHERE am_id = v.am_id AND period = v.period);

INSERT INTO sps_mv (am_id, period, target_revenue, actual_revenue, achievement_pct, refreshed_at) VALUES
  ('demo1', '2026-07', 60000000, 45000000, 75.00, NOW()),
  ('demo2', '2026-07', 50000000, 52000000, 104.00, NOW()),
  ('demo3', '2026-07', 80000000, 40000000, 50.00, NOW())
ON CONFLICT (am_id, period) DO NOTHING;

INSERT INTO sales_doc (deal_id, customer_id, customer_name, doc_type, title, draft_text, status, generated_by, model_used, approved_by, created_at)
SELECT * FROM (VALUES
  ('90000000-0000-0000-0000-000000000001'::uuid, NULL, 'RS Umum Daerah Demo Sehat', 'sph', 'SPH Reagen Hematologi Analyzer',
   'Surat Penawaran Harga untuk reagen hematologi analyzer 5-diff, 20 box/bulan.', 'approved', 'A6', 'demo-model', 'development.wrg@gmail.com', NOW() - INTERVAL '6 day'),
  ('90000000-0000-0000-0000-000000000003'::uuid, NULL, 'RS Bhayangkara Demo', 'offering_letter', 'Offering Letter Reagen Elektrolit',
   'Offering letter kerjasama reagen elektrolit rutin.', 'draft', 'A6', 'demo-model', NULL, NOW() - INTERVAL '3 day')
) AS v(deal_id, customer_id, customer_name, doc_type, title, draft_text, status, generated_by, model_used, approved_by, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sales_doc WHERE deal_id = v.deal_id AND doc_type = v.doc_type);

INSERT INTO coaching_note (am_id, period, metrics, strengths, gaps, recommendations, score, generated_by, created_at)
SELECT * FROM (VALUES
  ('demo1', '2026-06', '{"visits":18,"revenue":45000000,"compliance_rate":0.86}'::jsonb,
   '["Konsisten submit plan","Relasi kuat dengan RS besar"]'::jsonb,
   '["Follow-up tender masih lambat"]'::jsonb,
   '["Percepat follow-up H+1 setelah presentasi"]'::jsonb, 78.50, 'A11', NOW() - INTERVAL '5 day'),
  ('demo2', '2026-06', '{"visits":22,"revenue":52000000,"compliance_rate":0.95}'::jsonb,
   '["Achievement di atas target","Report tepat waktu"]'::jsonb,
   '["Perlu tambah coverage klinik kecil"]'::jsonb,
   '["Eksplor 2 klinik baru per bulan"]'::jsonb, 88.00, 'A11', NOW() - INTERVAL '5 day')
) AS v(am_id, period, metrics, strengths, gaps, recommendations, score, generated_by, created_at)
WHERE NOT EXISTS (SELECT 1 FROM coaching_note WHERE am_id = v.am_id AND period = v.period);

-- ════════════════════════════════════════════════════════════════════
-- ── Governance (audit_log, hitl_queue, decision_log) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO audit_log (use_case_id, session_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision, occurred_at)
SELECT * FROM (VALUES
  ('demo-uc-distillation', 'demo-sess-001', 'demo-corr-001', 'A1', 3::smallint, 'summarize.wa_group', 'R1', 'demo-in-hash-1', 'demo-out-hash-1', '{"demo":true}'::jsonb, NULL, NULL, NOW() - INTERVAL '2 day'),
  ('demo-uc-ar-watch',    'demo-sess-002', 'demo-corr-002', 'A2', 4::smallint, 'ar.alert.generated', 'R1', 'demo-in-hash-2', 'demo-out-hash-2', '{"demo":true}'::jsonb, NULL, NULL, NOW() - INTERVAL '1 day'),
  ('demo-uc-collection',  'demo-sess-003', 'demo-corr-003', 'A3', 5::smallint, 'collection_draft.approved', 'R2', 'demo-in-hash-3', 'demo-out-hash-3', '{"demo":true}'::jsonb, 'development.wrg@gmail.com', 'approve', NOW() - INTERVAL '1 day')
) AS v(use_case_id, session_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision, occurred_at)
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE correlation_id = v.correlation_id);

-- Payload HARUS cocok salah satu shape yang di-render apps/web/(dashboard)/hitl/page.tsx
-- (report_ambiguous_match / pipeline_authenticity_flag / anomaly_flag) — payload generik
-- `{"demo":true,...}` bikin frontend crash (field item/candidates/dll undefined).
INSERT INTO hitl_queue (correlation_id, agent_id, r_tier, hitl_level, payload, status, approver_id, decided_at, created_at)
SELECT * FROM (VALUES
  ('demo-hitl-001', 'A4', 'R2', 'L3',
   '{"type":"report_ambiguous_match","am_id":"demo1","item":{"customer":"RS Demo Sehat","hasil":"Follow-up tender alkes, calon closing bulan ini","next_action":"Kirim penawaran revisi"},"candidates":[{"deal_id":"90000000-0000-0000-0000-000000000001","customer_name":"RS Umum Daerah Demo Sehat","score":0.62},{"deal_id":"90000000-0000-0000-0000-000000000005","customer_name":"RS Panti Nirmala Demo","score":0.55}],"to_stage":"Negotiation"}'::jsonb,
   'pending', NULL, NULL, NOW() - INTERVAL '1 day'),
  ('demo-hitl-002', 'A6', 'R2', 'L2',
   '{"type":"pipeline_authenticity_flag","deal_id":"90000000-0000-0000-0000-000000000003","customer_name":"RS Bhayangkara Demo","am_id":"demo2","stage":"Offering","estimated_value":22000000,"flags":["nilai_di_luar_pola_historis"],"score":0.71}'::jsonb,
   'approved', 'development.wrg@gmail.com', NOW() - INTERVAL '6 day', NOW() - INTERVAL '6 day'),
  ('demo-hitl-003', 'A8', 'R2', 'L2',
   '{"type":"anomaly_flag","stream":"revenue","entity_id":"cabang-bali","label":"Revenue Cabang Bali","value":185000000,"score":2.8,"direction":"high","median":95000000}'::jsonb,
   'pending', NULL, NULL, NOW() - INTERVAL '3 hour')
) AS v(correlation_id, agent_id, r_tier, hitl_level, payload, status, approver_id, decided_at, created_at)
WHERE NOT EXISTS (SELECT 1 FROM hitl_queue WHERE correlation_id = v.correlation_id);

-- Perbaiki 2 baris lama kalau sudah kadung ke-insert dengan payload generik yang salah.
UPDATE hitl_queue SET payload =
  '{"type":"report_ambiguous_match","am_id":"demo1","item":{"customer":"RS Demo Sehat","hasil":"Follow-up tender alkes, calon closing bulan ini","next_action":"Kirim penawaran revisi"},"candidates":[{"deal_id":"90000000-0000-0000-0000-000000000001","customer_name":"RS Umum Daerah Demo Sehat","score":0.62},{"deal_id":"90000000-0000-0000-0000-000000000005","customer_name":"RS Panti Nirmala Demo","score":0.55}],"to_stage":"Negotiation"}'::jsonb
WHERE correlation_id = 'demo-hitl-001' AND payload->>'type' IS NULL;
UPDATE hitl_queue SET payload =
  '{"type":"pipeline_authenticity_flag","deal_id":"90000000-0000-0000-0000-000000000003","customer_name":"RS Bhayangkara Demo","am_id":"demo2","stage":"Offering","estimated_value":22000000,"flags":["nilai_di_luar_pola_historis"],"score":0.71}'::jsonb
WHERE correlation_id = 'demo-hitl-002' AND payload->>'type' IS NULL;

INSERT INTO decision_log (adr_number, title, decision, rationale, status, decided_by, decided_at, created_at)
SELECT * FROM (VALUES
  ('DEMO-ADR-001', 'Pakai OpenRouter multi-model per-task', 'Setujui pemakaian model berbeda per agen (haiku/deepseek).', 'Biaya lebih rendah utk task ringan.', 'APPROVED', 'development.wrg@gmail.com', NOW() - INTERVAL '30 day', NOW() - INTERVAL '30 day'),
  ('DEMO-ADR-002', 'Demo keputusan pending', 'Evaluasi migrasi tambahan sensor IoT alkes.', 'Masih tahap riset vendor.', 'PENDING', NULL, NULL, NOW() - INTERVAL '2 day')
) AS v(adr_number, title, decision, rationale, status, decided_by, decided_at, created_at)
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE adr_number = v.adr_number);

-- ════════════════════════════════════════════════════════════════════
-- ── AM reminder ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO am_reminder (am_id, am_name, reminder_date, note, customer_name, fired_h_minus_1, fired_h, created_at)
SELECT * FROM (VALUES
  ('demo1', 'Budi Demo', CURRENT_DATE + 1, 'Follow-up hasil nego harga reagen hematologi', 'RS Umum Daerah Demo Sehat', FALSE, FALSE, NOW() - INTERVAL '1 day'),
  ('demo2', 'Sari Demo', CURRENT_DATE + 2, 'Kirim SPH offering letter reagen elektrolit', 'RS Bhayangkara Demo', FALSE, FALSE, NOW() - INTERVAL '1 day'),
  ('demo1', 'Budi Demo', CURRENT_DATE - 1, 'Reminder kunjungan follow-up tender (sudah lewat)', 'RS Umum Daerah Demo Sehat', TRUE, TRUE, NOW() - INTERVAL '2 day')
) AS v(am_id, am_name, reminder_date, note, customer_name, fired_h_minus_1, fired_h, created_at)
WHERE NOT EXISTS (SELECT 1 FROM am_reminder WHERE am_id = v.am_id AND reminder_date = v.reminder_date AND note = v.note);

-- ════════════════════════════════════════════════════════════════════
-- ── WRG Monitor (digest, pola, member) + WA + sender_alias ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO monitor_digest (kind, tanggal, waktu, content, source_file) VALUES
  ('rekap',    CURRENT_DATE,       '10:00', 'Rekap demo 10:00 — 3 pesan grup Demo, tidak ada isu mendesak.', 'demo-seed'),
  ('rekap',    CURRENT_DATE,       '15:00', 'Rekap demo 15:00 — follow-up tender RS Demo Sehat berlanjut minggu depan.', 'demo-seed'),
  ('resume',   CURRENT_DATE,       '22:00', 'Resume harian demo — 2 plan, 1 report masuk, semua on-track.', 'demo-seed'),
  ('daily',    CURRENT_DATE - 1,   '22:00', 'Ringkasan harian demo H-1 — kunjungan tercapai 80%.', 'demo-seed'),
  ('weekly',   CURRENT_DATE - 7,   '22:00', 'Ringkasan mingguan demo — revenue naik 5% dari minggu lalu.', 'demo-seed'),
  ('briefing', CURRENT_DATE - 2,   '06:00', 'Weekend briefing demo — fokus follow-up 3 tender besar minggu ini.', 'demo-seed')
ON CONFLICT (kind, tanggal, waktu) DO NOTHING;

INSERT INTO monitor_pola (group_jid, group_name, content, updated_at) VALUES
  ('120000000001@g.us', 'Grup Demo Sales Surabaya', '## Pola komunikasi Grup Demo Sales Surabaya\n- Aktif jam 08.00-17.00\n- Topik dominan: plan/report harian, follow-up tender.', NOW()),
  ('120000000002@g.us', 'Grup Demo HoD Koordinasi', '## Pola komunikasi Grup Demo HoD Koordinasi\n- Aktif malam (20.00-21.00), rekap harian tim.', NOW())
ON CONFLICT (group_jid) DO NOTHING;

INSERT INTO monitor_member (phone, nama, panggilan, posisi, cabang, wa_name, group_count, in_roster, updated_at) VALUES
  ('628119000001', 'Budi Demo', 'Budi', 'Account Manager', 'Demo', 'Budi D.', 3, TRUE, NOW()),
  ('628119000002', 'Sari Demo', 'Sari', 'Account Manager', 'Demo', 'Sari D.', 2, TRUE, NOW()),
  ('628119000003', 'Andi Demo', 'Andi', 'HOD',             'Demo', 'Andi D.', 4, TRUE, NOW()),
  ('628119000004', 'Rina Tanpa Roster', NULL, NULL, NULL, 'Rina WA', 1, FALSE, NOW())
ON CONFLICT (phone) DO NOTHING;

INSERT INTO sender_alias (group_jid, pushname, am_id, note, created_at) VALUES
  ('120000000001@g.us', 'd', 'demo1', 'Pushname generik "d" di grup Demo Sales Surabaya = Budi Demo (HP bersama).', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO wa_message (id, group_jid, group_name, sender_jid, sender_name, message_type, body, input_hash, received_at) VALUES
  ('90000001-0000-0000-0000-000000000001', '120000000001@g.us', 'Grup Demo Sales Surabaya', '628119000001@s.whatsapp.net', 'Budi Demo', 'text', '#plan RS Demo Sehat - follow up tender alkes', 'demo-wa-hash-0001', NOW() - INTERVAL '1 day'),
  ('90000001-0000-0000-0000-000000000002', '120000000001@g.us', 'Grup Demo Sales Surabaya', '628119000002@s.whatsapp.net', 'Sari Demo', 'text', '#report Klinik Demo Jaya - closing PO kateter urine', 'demo-wa-hash-0002', NOW() - INTERVAL '1 day'),
  ('90000001-0000-0000-0000-000000000003', '120000000002@g.us', 'Grup Demo HoD Koordinasi', '628119000003@s.whatsapp.net', 'Andi Demo', 'text', 'Rekap minggu ini semua target on-track, RS Bhayangkara nego harga.', 'demo-wa-hash-0003', NOW() - INTERVAL '2 hour')
ON CONFLICT (id) DO NOTHING;

INSERT INTO digest_rekap (group_jid, group_name, period_start, period_end, bullets, action_items, konfirmasi_items, raw_output, model_used, created_at)
SELECT '120000000001@g.us', 'Grup Demo Sales Surabaya', NOW() - INTERVAL '5 hour', NOW(),
   '["Budi follow-up tender RS Demo Sehat","Sari closing PO Klinik Demo Jaya"]'::jsonb,
   '["Kirim SPH RS Demo Sehat sebelum Jumat"]'::jsonb,
   '["Konfirmasi harga kateter urine ke Sari"]'::jsonb,
   'Rekap otomatis demo 5 jam terakhir.', 'demo-model', NOW()
WHERE NOT EXISTS (SELECT 1 FROM digest_rekap WHERE group_jid = '120000000001@g.us' AND raw_output = 'Rekap otomatis demo 5 jam terakhir.');

INSERT INTO digest_resume (period_date, period_type, sections, raw_output, model_used, created_at)
SELECT * FROM (VALUES
  (CURRENT_DATE, 'morning', '{"plan":"2 plan masuk pagi ini","highlight":"Follow-up tender RS Demo Sehat"}'::jsonb, 'Resume pagi demo.', 'demo-model', NOW()),
  (CURRENT_DATE, 'evening', '{"report":"1 dari 2 plan sudah lapor","highlight":"Tender berlanjut minggu depan"}'::jsonb, 'Resume sore demo.', 'demo-model', NOW())
) AS v(period_date, period_type, sections, raw_output, model_used, created_at)
WHERE NOT EXISTS (SELECT 1 FROM digest_resume WHERE period_date = v.period_date AND period_type = v.period_type);

INSERT INTO digest_briefing (week_start, sections, raw_output, model_used, hitl_status, created_at)
SELECT date_trunc('week', CURRENT_DATE)::date, '{"highlight":"3 tender besar minggu ini","risk":"RS Demo Sehat nego harga alot"}'::jsonb, 'Weekend briefing demo mingguan.', 'demo-model', 'approved', NOW()
WHERE NOT EXISTS (SELECT 1 FROM digest_briefing WHERE week_start = date_trunc('week', CURRENT_DATE)::date);

INSERT INTO message_annotation (wa_message_id, group_jid, sender_name, sentiment, sentiment_score, entities, generated_by, model_used, created_at)
SELECT * FROM (VALUES
  ('90000001-0000-0000-0000-000000000001'::uuid, '120000000001@g.us', 'Budi Demo', 'neutral',  0.500, '[{"type":"customer","value":"RS Demo Sehat"}]'::jsonb, 'A8', 'demo-model', NOW() - INTERVAL '1 day'),
  ('90000001-0000-0000-0000-000000000003'::uuid, '120000000002@g.us', 'Andi Demo', 'positive', 0.780, '[{"type":"customer","value":"RS Bhayangkara Demo"},{"type":"competitor","value":"Demo Kompetitor A"}]'::jsonb, 'A8', 'demo-model', NOW() - INTERVAL '2 hour')
) AS v(wa_message_id, group_jid, sender_name, sentiment, sentiment_score, entities, generated_by, model_used, created_at)
WHERE NOT EXISTS (SELECT 1 FROM message_annotation WHERE wa_message_id = v.wa_message_id);

-- ════════════════════════════════════════════════════════════════════
-- ── Pricelist ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO pricelist (product_id, hpp, margin_pct, diskon_pct, pct_wrg, pct_promosi, pct_hod_sales, total_point, min_incentive_pts, max_incentive_pts, min_redemption, cutoff_days, west_area_confirmation, east_area_confirmation, status, published_at, published_by, created_by) VALUES
  (900001, 900000,  0.3500, 0.0500, 0.6000, 0.2500, 0.1500, 100, 10, 50, 5, 30, TRUE,  TRUE,  'published', NOW() - INTERVAL '10 day', 'development.wrg@gmail.com', 'development.wrg@gmail.com'),
  (900002, 30000,   0.4000, 0.0000, 0.6000, 0.2500, 0.1500, 50,  5,  25, 3, 30, TRUE,  TRUE,  'published', NOW() - INTERVAL '10 day', 'development.wrg@gmail.com', 'development.wrg@gmail.com'),
  (900003, 22000,   0.3000, 0.0500, 0.6000, 0.2500, 0.1500, 40,  5,  20, 3, 30, FALSE, TRUE,  'draft',     NULL, NULL, 'development.wrg@gmail.com'),
  (900010, 700000,  0.3200, 0.0000, 0.6000, 0.2500, 0.1500, 80,  8,  40, 5, 30, TRUE,  FALSE, 'draft',     NULL, NULL, 'development.wrg@gmail.com')
ON CONFLICT (product_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Competitor intel ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO competitor_intel (am_id, customer_name, tanggal, vendor, produk, produk_kategori, harga_text, harga_numeric, konteks, source, created_at)
SELECT * FROM (VALUES
  ('demo1', 'RS Umum Daerah Demo Sehat', CURRENT_DATE - 5, 'Demo Kompetitor A', 'Reagen Hematologi Analyzer', 'Reagen', 'Rp1.100.000/box', 1100000::numeric, 'Kompetitor tawarkan harga lebih rendah, RS minta nego', 'wa-report', NOW() - INTERVAL '5 day'),
  ('demo2', 'RS Bhayangkara Demo',      CURRENT_DATE - 3, 'Demo Kompetitor B', 'Reagen Elektrolit',        'Reagen', 'Rp950.000/box', 950000::numeric,  'Kompetitor B masuk lewat tender lama', 'manual', NOW() - INTERVAL '3 day')
) AS v(am_id, customer_name, tanggal, vendor, produk, produk_kategori, harga_text, harga_numeric, konteks, source, created_at)
WHERE NOT EXISTS (SELECT 1 FROM competitor_intel WHERE am_id = v.am_id AND customer_name = v.customer_name AND tanggal = v.tanggal AND vendor = v.vendor);

-- ════════════════════════════════════════════════════════════════════
-- ── Competitor extraction state (reuse activity_log id 900001 dari seed-dev.sql) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO competitor_extraction_state (activity_id, n_mentions, extracted_at, extraction_model) VALUES
  (900001, 1, NOW() - INTERVAL '1 day', 'demo-model')
ON CONFLICT (activity_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── HoD territory (hod_key nyata dari HOD_CONFIG: rocky=East, yogi=West) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO hod_territory (hod_key, cabang, source, updated_at) VALUES
  ('rocky', 'Bali',   'demo-seed', NOW()),
  ('rocky', 'Malang', 'demo-seed', NOW()),
  ('rocky', 'Jember', 'demo-seed', NOW()),
  ('rocky', 'Kediri', 'demo-seed', NOW()),
  ('yogi',  'Jakarta',      'demo-seed', NOW()),
  ('yogi',  'Cirebon',      'demo-seed', NOW()),
  ('yogi',  'Madiun',       'demo-seed', NOW()),
  ('yogi',  'Palembang',    'demo-seed', NOW())
ON CONFLICT (hod_key, cabang) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Leave / holiday ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO master_holiday (tanggal, keterangan) VALUES
  ('2026-01-01', 'Tahun Baru Masehi (demo)'),
  ('2026-03-21', 'Hari Raya Nyepi (demo)'),
  ('2026-05-01', 'Hari Buruh Internasional (demo)'),
  ('2026-08-17', 'HUT Kemerdekaan RI (demo)'),
  ('2026-12-25', 'Hari Raya Natal (demo)')
ON CONFLICT (tanggal) DO NOTHING;

INSERT INTO user_leave (am_id, start_date, end_date, jenis, keterangan, source, created_at)
SELECT * FROM (VALUES
  ('demo1', CURRENT_DATE - 2, CURRENT_DATE - 1, 'sakit', 'Demam, istirahat di rumah', 'manual', NOW() - INTERVAL '2 day'),
  ('demo2', CURRENT_DATE + 3, CURRENT_DATE + 5, 'cuti',  'Cuti tahunan keluarga',      'manual', NOW() - INTERVAL '1 day')
) AS v(am_id, start_date, end_date, jenis, keterangan, source, created_at)
WHERE NOT EXISTS (SELECT 1 FROM user_leave WHERE am_id = v.am_id AND start_date = v.start_date);

INSERT INTO leave_pending (am_id, nama, jenis, start_date, end_date, source_message_id, status, created_at, decided_at, decided_by)
SELECT * FROM (VALUES
  ('demo3', 'Andi Demo', 'ijin', CURRENT_DATE + 1, CURRENT_DATE + 1, 'demo-msg-0001', 'pending', NOW() - INTERVAL '3 hour', NULL::timestamptz, NULL::text),
  ('demo1', 'Budi Demo', 'sakit', CURRENT_DATE - 2, CURRENT_DATE - 1, 'demo-msg-0002', 'approved', NOW() - INTERVAL '2 day', NOW() - INTERVAL '2 day', 'development.wrg@gmail.com')
) AS v(am_id, nama, jenis, start_date, end_date, source_message_id, status, created_at, decided_at, decided_by)
WHERE NOT EXISTS (SELECT 1 FROM leave_pending WHERE source_message_id = v.source_message_id);

INSERT INTO leave_scan_seen (message_id, status, scanned_at) VALUES
  ('demo-msg-0001', 'pending', NOW() - INTERVAL '3 hour'),
  ('demo-msg-0002', 'approved', NOW() - INTERVAL '2 day')
ON CONFLICT (message_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Sales target scope (cabang/AM) + region target + customer target cabang ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO sales_target_cabang (year, cabang, target, updated_at) VALUES
  (2026, 'Malang',   600000000, NOW()),
  (2026, 'Jakarta',  900000000, NOW()),
  (2026, 'Bali',     400000000, NOW()),
  (2026, 'Kediri',   350000000, NOW()),
  (2026, 'Cirebon',  300000000, NOW()),
  (2026, 'Madiun',   250000000, NOW())
ON CONFLICT (year, cabang) DO NOTHING;

INSERT INTO sales_target_am (year, am_id, target, updated_at) VALUES
  (2026, 'demo1', 700000000, NOW()),
  (2026, 'demo2', 600000000, NOW()),
  (2026, 'demo3', 900000000, NOW())
ON CONFLICT (year, am_id) DO NOTHING;

INSERT INTO sales_region_target (year, period, region, target, updated_at) VALUES
  (2026, 'year',    'East', 1800000000, NOW()),
  (2026, 'year',    'West', 900000000,  NOW()),
  (2026, 'quarter', 'East', 450000000,  NOW()),
  (2026, 'quarter', 'West', 225000000,  NOW()),
  (2026, 'month',   'East', 150000000,  NOW()),
  (2026, 'month',   'West', 75000000,   NOW())
ON CONFLICT (year, period, region) DO NOTHING;

INSERT INTO customer_target_cabang (year, cabang, target, updated_at) VALUES
  (2026, 'Malang',  25, NOW()),
  (2026, 'Jakarta', 40, NOW()),
  (2026, 'Bali',    15, NOW()),
  (2026, 'Kediri',  18, NOW())
ON CONFLICT (year, cabang) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── CRM account & contact (F62 Account & Contact 360) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO crm_account (account_id, tipe, kelas_rs, wilayah, cabang, npwp, status_bayar, notes, owner_am_id, updated_at) VALUES
  (900001, 'RS Pemerintah', 'B', 'Jawa Timur',    'Surabaya Pusat', '01.234.567.8-901.000', 'BPJS', 'Pelanggan lama, tender rutin tiap semester.', 'demo1', NOW()),
  (900002, 'RS Swasta',     'B', 'Jawa Timur',    'Surabaya Pusat', '01.234.567.8-902.000', 'Umum', 'Fokus produk reagen kimia klinik.',           'demo1', NOW()),
  (900003, 'Klinik',        'C', 'Jawa Timur',    'Surabaya Pusat', NULL,                   'Umum', 'Klinik baru, potensi berkembang.',            'demo1', NOW()),
  (900004, 'Lab Mandiri',   'C', 'DKI Jakarta',   'Jakarta',        '01.234.567.8-904.000', 'Umum', 'Lab rujukan, butuh consumables rutin.',       'demo2', NOW()),
  (900005, 'RS Pemerintah', 'A', 'DKI Jakarta',   'Jakarta',        '01.234.567.8-905.000', 'BPJS', 'RS besar, nego harga ketat.',                  'demo2', NOW()),
  (900006, 'Klinik',        'C', 'DKI Jakarta',   'Jakarta',        NULL,                   'Umum', 'Klinik jaringan, order bulanan stabil.',      'demo2', NOW()),
  (900007, 'RS Swasta',     'B', 'Jawa Timur',    'Malang',         '01.234.567.8-907.000', 'Umum', 'Prospek, belum ada transaksi rutin.',          'demo1', NOW()),
  (900008, 'Distributor',   'D', 'Jawa Timur',    'Surabaya Pusat', NULL,                   'Umum', 'Puskesmas, pengadaan via tender.',             NULL,    NOW())
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO crm_contact (account_id, nama, jabatan, role_deal, hp_wa, email, is_primary, seq, notes, created_at, updated_at)
SELECT * FROM (VALUES
  (900001, 'dr. Demo Kabag Pengadaan',   'Kepala Bagian Pengadaan', 'economic_buyer', '6281199990001', 'pengadaan@demosehat.example', TRUE,  1, 'Kontak utama tender.', NOW(), NOW()),
  (900001, 'Demo Staf Farmasi',          'Staf Farmasi',            'user',           '6281199990002', NULL, FALSE, 2, NULL, NOW(), NOW()),
  (900004, 'Demo Kepala Lab',            'Kepala Laboratorium',     'technical',      '6281199990003', 'kepalalab@demoprimalab.example', TRUE, 1, 'Champion produk vacutainer.', NOW(), NOW()),
  (900005, 'Demo Direktur RS',           'Direktur',                'economic_buyer', '6281199990004', NULL, TRUE, 1, 'Approval akhir nego harga.', NOW(), NOW())
) AS v(account_id, nama, jabatan, role_deal, hp_wa, email, is_primary, seq, notes, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM crm_contact WHERE account_id = v.account_id AND nama = v.nama);

-- ════════════════════════════════════════════════════════════════════
-- ── Logs operasional (delivery_log, email_log, alert_log) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO delivery_log (source, to_kind, target, text_preview, delivered, attempts, message_id_out, error, created_at)
SELECT * FROM (VALUES
  ('scheduler', 'group', '120000000001@g.us', 'Reminder plan H-1 esok hari...', TRUE, 1, 'demo-msgout-0001', NULL, NOW() - INTERVAL '1 day'),
  ('scheduler', 'group', '120000000002@g.us', 'Rekap 22:00 harian...', TRUE, 1, 'demo-msgout-0002', NULL, NOW() - INTERVAL '5 hour'),
  ('scheduler', 'group', '120000000001@g.us', 'Notif AR overdue...', FALSE, 2, NULL, 'timeout wa-bridge (demo)', NOW() - INTERVAL '3 hour')
) AS v(source, to_kind, target, text_preview, delivered, attempts, message_id_out, error, created_at)
WHERE NOT EXISTS (SELECT 1 FROM delivery_log WHERE text_preview = v.text_preview AND target = v.target);

INSERT INTO email_log (kind, recipients, subject, range_from, range_to, delivered, message_id, error, created_at)
SELECT * FROM (VALUES
  ('weekly-report', '["development.wrg@gmail.com"]'::jsonb, 'Laporan Mingguan Demo (contoh)', CURRENT_DATE - 7, CURRENT_DATE, TRUE, 'demo-email-0001', NULL, NOW() - INTERVAL '1 day'),
  ('ar-alert',       '["development.wrg@gmail.com"]'::jsonb, 'AR Overdue >90 hari (demo)',     CURRENT_DATE - 90, CURRENT_DATE, FALSE, NULL, 'SMTP demo unreachable', NOW() - INTERVAL '6 hour')
) AS v(kind, recipients, subject, range_from, range_to, delivered, message_id, error, created_at)
WHERE NOT EXISTS (SELECT 1 FROM email_log WHERE kind = v.kind AND subject = v.subject);

INSERT INTO alert_log (kind, level, title, body, payload, channels_delivered, created_at)
SELECT * FROM (VALUES
  ('ar-aging',       'warning', 'AR Overdue >60 hari (demo)', 'RS Siti Khodijah Demo Sepanjang overdue 88 hari.', '{"customer_id":"900009"}'::jsonb, '["wa","email"]'::jsonb, NOW() - INTERVAL '1 day'),
  ('quota-notif',    'info',    'Kuota AI mendekati limit (demo)', 'Pemakaian token bulan ini 80% dari kuota.', '{"pct":80}'::jsonb, '["wa"]'::jsonb, NOW() - INTERVAL '4 hour')
) AS v(kind, level, title, body, payload, channels_delivered, created_at)
WHERE NOT EXISTS (SELECT 1 FROM alert_log WHERE kind = v.kind AND title = v.title);

-- ════════════════════════════════════════════════════════════════════
-- ── Sales analytics (saved view + alert) — pakai app_user admin existing ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO sales_analytics_view_config (user_id, view_name, view_type, filter_config, is_default, is_shared)
SELECT u.id, 'Executive Demo', 'executive', '{"period":"2026-07"}'::jsonb, TRUE, TRUE
FROM app_user u WHERE u.email = 'you@wahanalifeline.co.id'
ON CONFLICT (user_id, view_name) DO NOTHING;

INSERT INTO sales_analytics_view_config (user_id, view_name, view_type, filter_config, is_default, is_shared)
SELECT u.id, 'Per Cabang Demo', 'per_cabang', '{"cabang":["Surabaya Pusat","Jakarta"]}'::jsonb, FALSE, FALSE
FROM app_user u WHERE u.email = 'you@wahanalifeline.co.id'
ON CONFLICT (user_id, view_name) DO NOTHING;

INSERT INTO sales_analytics_alert (alert_name, owner_user_id, metric_key, dimension_filter, threshold_operator, threshold_value, window_days, wa_target_jid, active, last_triggered_at, last_state, created_at)
SELECT 'Demo AR > 90 hari', u.id, 'ar_gt_90', '{}'::jsonb, 'gt', 5000000, 7, '120000000002@g.us', TRUE, NOW() - INTERVAL '1 day', 'triggered', NOW() - INTERVAL '10 day'
FROM app_user u WHERE u.email = 'you@wahanalifeline.co.id'
  AND NOT EXISTS (SELECT 1 FROM sales_analytics_alert a WHERE a.alert_name = 'Demo AR > 90 hari' AND a.owner_user_id = u.id);

INSERT INTO sales_analytics_alert (alert_name, owner_user_id, metric_key, dimension_filter, threshold_operator, threshold_value, window_days, wa_target_jid, active, last_triggered_at, last_state, created_at)
SELECT 'Demo Revenue Drop', u.id, 'revenue', '{"cabang":"Malang"}'::jsonb, 'delta_pct_lt', -10, 30, NULL, TRUE, NULL, NULL, NOW() - INTERVAL '5 day'
FROM app_user u WHERE u.email = 'you@wahanalifeline.co.id'
  AND NOT EXISTS (SELECT 1 FROM sales_analytics_alert a WHERE a.alert_name = 'Demo Revenue Drop' AND a.owner_user_id = u.id);

-- ════════════════════════════════════════════════════════════════════
-- ── Master territory (am_panggilan unik → hod_panggilan/cabang/kota) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO master_territory (am_panggilan, hod_panggilan, cabang, kota) VALUES
  ('Budi', 'Rocky', 'Demo', 'Surabaya'),
  ('Sari', 'Yogi',  'Demo', 'Jakarta'),
  ('Andi', 'Rocky', 'Demo', 'Malang')
ON CONFLICT (am_panggilan, cabang, kota) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Visit (geotag kunjungan) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO visit (deal_id, am_id, customer_name, photo_url, visit_lat, visit_lon, visit_timestamp, visit_date, geo_status, note, created_at)
SELECT * FROM (VALUES
  ('90000000-0000-0000-0000-000000000001'::uuid, 'demo1', 'RS Umum Daerah Demo Sehat', 'https://example.com/demo/visit1.jpg', -7.257472::numeric, 112.752090::numeric, NOW() - INTERVAL '1 day', CURRENT_DATE - 1, 'ok', 'Kunjungan follow-up tender.', NOW() - INTERVAL '1 day'),
  ('90000000-0000-0000-0000-000000000003'::uuid, 'demo2', 'RS Bhayangkara Demo',       'https://example.com/demo/visit2.jpg', -6.200000::numeric, 106.816666::numeric, NOW() - INTERVAL '2 day', CURRENT_DATE - 2, 'ok', 'Presentasi produk reagen elektrolit.', NOW() - INTERVAL '2 day'),
  (NULL::uuid, 'demo1', 'Klinik Pratama Demo Jaya', NULL, NULL::numeric, NULL::numeric, NOW() - INTERVAL '3 day', CURRENT_DATE - 3, 'no_geo', 'Foto tanpa metadata geotag (HP lama).', NOW() - INTERVAL '3 day')
) AS v(deal_id, am_id, customer_name, photo_url, visit_lat, visit_lon, visit_timestamp, visit_date, geo_status, note, created_at)
WHERE NOT EXISTS (SELECT 1 FROM visit WHERE am_id = v.am_id AND customer_name = v.customer_name AND visit_date = v.visit_date);

-- ════════════════════════════════════════════════════════════════════
-- ── Notif state ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO notif_state (key, signature, count, sent_at) VALUES
  ('demo-notif-tua-surabaya', 'demo-sig-abc123', 3, NOW() - INTERVAL '1 day')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── RBAC membership (link admin user existing → grup administrator) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO app_user_group (user_id, group_id)
SELECT u.id, g.id FROM app_user u, access_group g
WHERE u.email = 'you@wahanalifeline.co.id' AND g.key = 'administrator'
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── NPK Engine (score semester, aspect score, override log) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO npk_score_semester (hod_key, year, period, npk, predikat, computed_from, computed_at) VALUES
  ('rocky', 2026, 'S1', 82.50, 'baik',   '{"demo":true,"stub":false}'::jsonb, NOW() - INTERVAL '20 day'),
  ('yogi',  2026, 'S1', 74.00, 'cukup',  '{"demo":true,"stub":false}'::jsonb, NOW() - INTERVAL '20 day')
ON CONFLICT (hod_key, year, period) DO NOTHING;

INSERT INTO npk_aspect_score (hod_key, year, period, aspect, raw, capped, weight, contribution, available) VALUES
  ('rocky', 2026, 'S1', 'revenue',  95.00, 95.00, 25, 23.75, TRUE),
  ('rocky', 2026, 'S1', 'customer', 88.00, 88.00, 15, 13.20, TRUE),
  ('rocky', 2026, 'S1', 'ar',       70.00, 70.00, 10, 7.00,  TRUE),
  ('rocky', 2026, 'S1', 'kso',      60.00, 60.00, 15, 9.00,  TRUE),
  ('rocky', 2026, 'S1', 'gp',       80.00, 80.00, 15, 12.00, TRUE),
  ('rocky', 2026, 'S1', 'crm',      NULL,  NULL,  10, 0,     FALSE),
  ('rocky', 2026, 'S1', 'coaching', 75.00, 75.00, 10, 7.50,  TRUE),
  ('yogi',  2026, 'S1', 'revenue',  70.00, 70.00, 25, 17.50, TRUE),
  ('yogi',  2026, 'S1', 'customer', 65.00, 65.00, 15, 9.75,  TRUE),
  ('yogi',  2026, 'S1', 'ar',       55.00, 55.00, 10, 5.50,  TRUE),
  ('yogi',  2026, 'S1', 'kso',      50.00, 50.00, 15, 7.50,  TRUE),
  ('yogi',  2026, 'S1', 'gp',       68.00, 68.00, 15, 10.20, TRUE),
  ('yogi',  2026, 'S1', 'crm',      NULL,  NULL,  10, 0,     FALSE),
  ('yogi',  2026, 'S1', 'coaching', 65.00, 65.00, 10, 6.50,  TRUE)
ON CONFLICT (hod_key, year, period, aspect) DO NOTHING;

INSERT INTO npk_override_log (hod_key, year, period, aspect, old_value, new_value, reason, changed_by, changed_at)
SELECT 'rocky', 2026, 'S1', 'kso', 55.00, 60.00, 'Koreksi data KSO yang tertinggal input (demo).', 'development.wrg@gmail.com', NOW() - INTERVAL '15 day'
WHERE NOT EXISTS (
  SELECT 1 FROM npk_override_log WHERE hod_key = 'rocky' AND year = 2026 AND period = 'S1' AND aspect = 'kso'
);

-- ════════════════════════════════════════════════════════════════════
-- ── KPI measurement (kpi_id reuse dari kpi existing seed governance) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO kpi_measurement (kpi_id, period, achievement_pct, actual, note, updated_at)
SELECT k.id, '2026-06', v.pct, v.actual, 'Demo pengukuran KPI Juni 2026', NOW()
FROM kpi k
JOIN (VALUES (1, 92.5, '37 kunjungan'), (2, 105.0, 'Rp420jt'), (3, 80.0, '4 customer baru'),
             (6, 98.0, '35 visit'), (7, 110.0, '3 customer baru')) AS v(kpi_id, pct, actual)
  ON k.id = v.kpi_id
ON CONFLICT (kpi_id, period) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── Raport narrative (am_id reuse demo1/demo2/demo3) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO raport_narrative (am_id, period, verdict, headline, narrative, model, created_at) VALUES
  ('demo1', '2026-06', 'ya', 'Budi Demo layak dapat apresiasi bulan ini.',
   '{"pantas_puas":["Compliance plan-report tinggi","Revenue mendekati target"],"penahan":["Follow-up tender masih lambat"],"bsc":{"fin":"baik","cust":"baik","proc":"cukup","learn":"baik"},"akar_masalah":"Kapasitas follow-up tender terbatas.","catatan_adil":"Dibanding AM lain di area sama, performa relatif setara.","ringkasan":"Overall baik, perlu percepat follow-up.","predikat":"baik"}'::jsonb,
   'demo-model', NOW() - INTERVAL '2 day'),
  ('demo2', '2026-06', 'ya', 'Sari Demo melampaui target revenue.',
   '{"pantas_puas":["Achievement 104%","Compliance 95%"],"penahan":[],"bsc":{"fin":"sangat baik","cust":"baik","proc":"baik","learn":"baik"},"akar_masalah":"","catatan_adil":"Konsisten 2 bulan terakhir.","ringkasan":"Sangat baik, pertahankan.","predikat":"sangat_baik"}'::jsonb,
   'demo-model', NOW() - INTERVAL '2 day'),
  ('demo3', '2026-06', 'bersyarat', 'Andi Demo perlu perbaikan achievement.',
   '{"pantas_puas":["Kepemimpinan tim baik"],"penahan":["Achievement 50% dari target"],"bsc":{"fin":"kurang","cust":"cukup","proc":"cukup","learn":"baik"},"akar_masalah":"Beberapa tender besar tertunda.","catatan_adil":"Faktor eksternal (tender pemerintah mundur) turut berpengaruh.","ringkasan":"Perlu perhatian khusus bulan depan.","predikat":"cukup"}'::jsonb,
   'demo-model', NOW() - INTERVAL '2 day')
ON CONFLICT (am_id, period) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── WatchPoint Weekly (hod_key nyata; source='db' WAJIB ikut, lihat CLAUDE.md) ──
-- ════════════════════════════════════════════════════════════════════

INSERT INTO watchpoint_weekly (hod_key, iso_year, iso_week, metric_key, target, actual, status, note, source, updated_at) VALUES
  ('rocky',    2026, 30, 'revenue', 150000000, 142000000, NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('rocky',    2026, 30, 'visits',  48,         44,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('yogi',     2026, 30, 'revenue', 75000000,  80000000,  NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('yogi',     2026, 30, 'churn',   0,          1,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('mufid',    2026, 30, 'clia',    3,          2,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('arman',    2026, 30, 'okupansi',48,         45,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('pakMuhid', 2026, 30, 'uptime',  95,         93,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('ika',      2026, 30, 'fillrate',95,         96,        NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('fafa',     2026, 30, 'close',   10,         9,         NULL,   'Snapshot minggu 30 (demo).', 'db', NOW() - INTERVAL '7 day'),
  ('husni',    2026, 30, 'dash',    NULL,       NULL,      'GREEN','Dashboard tetap live (demo manual).', 'manual', NOW() - INTERVAL '7 day')
ON CONFLICT (hod_key, iso_year, iso_week, metric_key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── WatchPoint HoD (tab "Ringkasan HoD") — metric MANUAL utk 5 HoD non-sales ──
-- Tanpa baris ini, buildMetric() di watchpoint.ts tak nemu row manual →
-- actual=null → status NA utk semua metric non-compute mufid/arman/pakMuhid/ika/fafa.
-- (husni sudah ada 3 baris dari migrasi; noorder/ar90 dilewati krn punya `compute()` live.)
-- ════════════════════════════════════════════════════════════════════

-- rocky/yogi metric revenue/prod/visits DIHITUNG LIVE dari accurate_invoice/sales_plan
-- ter-scope cabang (hod_territory). master_user demo1/2/3 cabang='Demo' — tanpa mapping
-- ini, rocky/yogi selalu 0/RED walau accurate_invoice sudah ada data (bukan NA, tapi
-- kosong krn cabang tak match). Assign 'Demo' ke rocky saja (yogi sengaja dibiarkan
-- 0 - realistis kalau territory-nya memang belum ada invoice).
INSERT INTO hod_territory (hod_key, cabang, source) VALUES
  ('rocky', 'Demo', 'demo-seed')
ON CONFLICT (hod_key, cabang) DO NOTHING;

INSERT INTO watchpoint_metric (hod_key, metric_key, actual, status_override, note) VALUES
  ('mufid',    'clia',      4,    NULL, 'Demo: 4 site CLIA ≥800 tes/bln.'),
  ('mufid',    'fia',       22,   NULL, 'Demo: 22 customer FIA aktif.'),
  ('mufid',    'jv',        1,    NULL, 'Demo: 1 JV principal baru.'),
  ('mufid',    'xsell',     1,    NULL, 'Demo: 1 deal cross-sell reguler→CLIA.'),
  ('mufid',    'moq',       NULL, 'GREEN', 'Demo: MOQ Snibe Q3 sudah diputus.'),
  ('arman',    'hd',        1,    NULL, 'Demo: 1 site HD maju 1 milestone.'),
  ('arman',    'okupansi',  45,   NULL, 'Demo: okupansi 45 tindakan/mesin/bln.'),
  ('arman',    'coloc',     3,    NULL, 'Demo: 3 site co-location CLIA.'),
  ('arman',    'jv',        1,    NULL, 'Demo: 1 JV principal (Edan/Miki/Oneject).'),
  ('arman',    'xsell',     2,    NULL, 'Demo: 2 deal cross-sell.'),
  ('pakMuhid', 'uptime',    97,   NULL, 'Demo: uptime rata-rata 97%/analyzer.'),
  ('pakMuhid', 'rar',       210000000, NULL, 'Demo: RaR 210jt/cabang.'),
  ('pakMuhid', 'install',   6,    NULL, 'Demo: lead time install 6 hari.'),
  ('ika',      'fillrate',  96,   NULL, 'Demo: fill rate 96%.'),
  ('ika',      'refi',      1,    NULL, 'Demo: 1 milestone refinancing.'),
  ('ika',      'runway',    NULL, 'GREEN', 'Demo: cash runway ~8 minggu, aman.'),
  ('fafa',     'close',     9,    NULL, 'Demo: close cycle 9 hari.'),
  ('fafa',     'opex',      33,   NULL, 'Demo: OPEX ratio 33%.'),
  ('fafa',     'revstream', NULL, 'GREEN', 'Demo: laporan revenue-by-stream Juli sudah terbit.'),
  ('fafa',     'gp',        NULL, 'GREEN', 'Demo: laporan GP per stream Juli sudah terbit.')
ON CONFLICT (hod_key, metric_key) DO UPDATE SET
  actual = EXCLUDED.actual, status_override = EXCLUDED.status_override, note = EXCLUDED.note;

-- ════════════════════════════════════════════════════════════════════
-- ── Visits — halaman /visits BACA dari sales_plan (visit_lat/visit_lon), BUKAN
-- tabel `visit` legacy (lihat komentar apps/api/src/repo/visit.ts). Isi geo di
-- sales_plan yang sudah ada + tambah 2 baris demo2/demo3 supaya ada variasi AM. ──
-- ════════════════════════════════════════════════════════════════════

UPDATE sales_plan SET visit_lat = -7.2575, visit_lon = 112.7521
  WHERE id = 900001 AND visit_lat IS NULL;   -- RS Demo Sehat, Surabaya
UPDATE sales_plan SET visit_lat = -6.2088, visit_lon = 106.8456
  WHERE id = 900002 AND visit_lat IS NULL;   -- Klinik Demo Jaya, Jakarta

INSERT INTO sales_plan (id, am_id, tanggal, customer_name, tujuan, goal, seq, visit_lat, visit_lon, submitted_at) VALUES
  (900011, 'demo2', CURRENT_DATE, 'RS Bhayangkara Demo', 'Kunjungan rutin restock reagen', 'Maintain hubungan', 1, -8.6705, 115.2126, NOW()),
  (900012, 'demo3', CURRENT_DATE, 'Klinik Utama Demo Medika', 'Survey kebutuhan alat baru', 'Prospek deal baru', 1, -7.7956, 110.3695, NOW())
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ── NPK Direktur — lengkapi npk_score_semester + npk_aspect_score utk 6 HoD
-- yang belum ada baris (mufid/arman/pakMuhid/ika/fafa/husni) + period S2 2026
-- (default view apps/web/(dashboard)/npk/page.tsx utk bulan>=Jul). rocky/yogi
-- sebelumnya cuma S1 → ditambah S2 juga biar toggle periode konsisten.
--
-- CATATAN JUJUR: berbeda dari compute live (lihat npk.ts "KEJUJURAN DATA" — aspek
-- kso/gp/crm/coaching SELALU stub krn sumbernya belum ada di sistem, dan revenue/
-- customer/ar SELALU stub utk HoD non-cabang), baris di bawah ini SEMUA aspek
-- diisi `available:true` dgn angka dummy murni utk keperluan tampilan demo lokal.
-- Kalau endpoint POST /npk/compute dipanggil, angka ini akan DITIMPA balik ke
-- mayoritas stub/0 sesuai batasan sistem yang sebenarnya saat ini.
-- ════════════════════════════════════════════════════════════════════

WITH cfg(hod_key, period, npk_val) AS (
  VALUES
    ('mufid',    'S1', 78::numeric), ('mufid',    'S2', 78::numeric),
    ('arman',    'S1', 91::numeric), ('arman',    'S2', 91::numeric),
    ('pakMuhid', 'S1', 68::numeric), ('pakMuhid', 'S2', 68::numeric),
    ('ika',      'S1', 72::numeric), ('ika',      'S2', 72::numeric),
    ('fafa',     'S1', 85::numeric), ('fafa',     'S2', 85::numeric),
    ('husni',    'S1', 95::numeric), ('husni',    'S2', 95::numeric),
    ('rocky',    'S2', 84::numeric),
    ('yogi',     'S2', 77::numeric)
)
INSERT INTO npk_score_semester (hod_key, year, period, npk, predikat, computed_from)
SELECT hod_key, 2026, period, npk_val,
  CASE WHEN npk_val >= 90 THEN 'sangat_baik' WHEN npk_val >= 75 THEN 'baik'
       WHEN npk_val >= 60 THEN 'cukup' WHEN npk_val >= 50 THEN 'kurang' ELSE 'buruk' END,
  '{"demo": true, "stub": false, "note": "seed lengkap semua HoD utk dev lokal, bukan hasil compute live"}'::jsonb
FROM cfg
ON CONFLICT (hod_key, year, period) DO NOTHING;

WITH cfg(hod_key, period, npk_val) AS (
  VALUES
    ('mufid',    'S1', 78::numeric), ('mufid',    'S2', 78::numeric),
    ('arman',    'S1', 91::numeric), ('arman',    'S2', 91::numeric),
    ('pakMuhid', 'S1', 68::numeric), ('pakMuhid', 'S2', 68::numeric),
    ('ika',      'S1', 72::numeric), ('ika',      'S2', 72::numeric),
    ('fafa',     'S1', 85::numeric), ('fafa',     'S2', 85::numeric),
    ('husni',    'S1', 95::numeric), ('husni',    'S2', 95::numeric),
    ('rocky',    'S2', 84::numeric),
    ('yogi',     'S2', 77::numeric)
),
aspects(aspect, weight) AS (
  VALUES ('revenue',25), ('customer',15), ('ar',10), ('kso',15), ('gp',15), ('crm',10), ('coaching',10)
)
INSERT INTO npk_aspect_score (hod_key, year, period, aspect, raw, capped, weight, contribution, available)
SELECT c.hod_key, 2026, c.period, a.aspect, c.npk_val, c.npk_val, a.weight,
       ROUND(c.npk_val * a.weight / 100.0, 2), true
FROM cfg c CROSS JOIN aspects a
ON CONFLICT (hod_key, year, period, aspect) DO NOTHING;

-- F26 — Seed teknisi_roster (DUMMY utk dev/demo, bukan data asli). Nama asli +
-- no WA asli diisi Direktur manual langsung ke DB (tidak ada UI tambah-teknisi
-- di F26 ini per keputusan "pakai seed dulu").
INSERT INTO teknisi_roster (nama, wa_number, area) VALUES
  ('Teknisi Andi',  '628110000001', ARRAY['Surabaya','Sidoarjo']),
  ('Teknisi Budi',  '628110000002', ARRAY['Jakarta','Tangerang']),
  ('Teknisi Citra', '628110000003', ARRAY['Bandung']),
  ('Teknisi Dedi',  '628110000004', ARRAY['Surabaya','Malang']),
  ('Teknisi Eka',   '628110000005', ARRAY['Jakarta'])
ON CONFLICT (nama) DO NOTHING;

COMMIT;

\echo 'seed-dev-full.sql selesai.'
