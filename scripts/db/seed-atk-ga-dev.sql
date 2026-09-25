-- seed-atk-ga-dev.sql — data SINTETIS modul ATK & GA Helpdesk (dev/demo, BUKAN prod).
-- Mengisi menu: /atk-master, /atk-stock-in, /atk-stock-out, /atk-stock-opname, /ga-helpdesk.
-- Konvensi ikut seed-dev-full.sql: idempoten, uuid dummy '90000000-...-0000000000XX',
-- nama fiktif, tanggal RELATIF (now()/CURRENT_DATE) supaya tak basi saat direseed.

BEGIN;

-- ── ATK: kategori & supplier ──
INSERT INTO atk_category (id, name, description, is_active) VALUES
  ('90000000-0000-0000-0000-0000000a0001', 'Alat Tulis',   'Pulpen, pensil, spidol', TRUE),
  ('90000000-0000-0000-0000-0000000a0002', 'Kertas',       'HVS, kop surat, continuous form', TRUE),
  ('90000000-0000-0000-0000-0000000a0003', 'Consumable IT','Toner, tinta, baterai', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO atk_supplier (id, name, contact_person, phone, is_active) VALUES
  ('90000000-0000-0000-0000-0000000b0001', 'CV Sumber Kertas Demo', 'Pak Yanto Demo', '628000000101', TRUE),
  ('90000000-0000-0000-0000-0000000b0002', 'PT Tinta Nusantara Demo','Bu Rina Demo',  '628000000102', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── ATK: barang ──
INSERT INTO atk_item (id, name, unit, category_id, default_supplier_id, min_stock, is_active) VALUES
  ('90000000-0000-0000-0000-0000000c0001', 'Pulpen Biru',            'pcs',  '90000000-0000-0000-0000-0000000a0001', '90000000-0000-0000-0000-0000000b0001', 24, TRUE),
  ('90000000-0000-0000-0000-0000000c0002', 'Spidol Whiteboard Hitam','pcs',  '90000000-0000-0000-0000-0000000a0001', '90000000-0000-0000-0000-0000000b0001', 12, TRUE),
  ('90000000-0000-0000-0000-0000000c0003', 'Kertas HVS A4 80gr',     'rim',  '90000000-0000-0000-0000-0000000a0002', '90000000-0000-0000-0000-0000000b0001', 20, TRUE),
  ('90000000-0000-0000-0000-0000000c0004', 'Kertas Kop Surat',       'rim',  '90000000-0000-0000-0000-0000000a0002', '90000000-0000-0000-0000-0000000b0001', 5,  TRUE),
  ('90000000-0000-0000-0000-0000000c0005', 'Toner Printer Mono',     'unit', '90000000-0000-0000-0000-0000000a0003', '90000000-0000-0000-0000-0000000b0002', 3,  TRUE),
  ('90000000-0000-0000-0000-0000000c0006', 'Baterai AA',             'pack', '90000000-0000-0000-0000-0000000a0003', '90000000-0000-0000-0000-0000000b0002', 6,  TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── ATK: mutasi stok (in = pembelian, out = pengambilan) ──
-- movement_type dibatasi CHECK ke 'in'/'out'; qty > 0.
INSERT INTO atk_stock_movement (id, item_id, movement_type, qty, movement_date, reference, pic, cabang, notes) VALUES
  ('90000000-0000-0000-0000-0000000d0001', '90000000-0000-0000-0000-0000000c0003', 'in',  50, CURRENT_DATE - 21, 'PO-DEMO-ATK-001', 'Fitri Demo',  'SURABAYA', 'Stok awal kuartal'),
  ('90000000-0000-0000-0000-0000000d0002', '90000000-0000-0000-0000-0000000c0001', 'in',  120,CURRENT_DATE - 21, 'PO-DEMO-ATK-001', 'Fitri Demo',  'SURABAYA', NULL),
  ('90000000-0000-0000-0000-0000000d0003', '90000000-0000-0000-0000-0000000c0005', 'in',  6,  CURRENT_DATE - 18, 'PO-DEMO-ATK-002', 'Fitri Demo',  'SURABAYA', 'Toner cadangan'),
  ('90000000-0000-0000-0000-0000000d0004', '90000000-0000-0000-0000-0000000c0006', 'in',  20, CURRENT_DATE - 14, 'PO-DEMO-ATK-002', 'Fitri Demo',  'SURABAYA', NULL),
  ('90000000-0000-0000-0000-0000000d0005', '90000000-0000-0000-0000-0000000c0002', 'in',  30, CURRENT_DATE - 14, 'PO-DEMO-ATK-003', 'Fitri Demo',  'MALANG',   NULL),
  ('90000000-0000-0000-0000-0000000d0006', '90000000-0000-0000-0000-0000000c0003', 'out', 12, CURRENT_DATE - 10, 'REQ-DEMO-014',    'Krisna Demo', 'SURABAYA', 'Kebutuhan admin penjualan'),
  ('90000000-0000-0000-0000-0000000d0007', '90000000-0000-0000-0000-0000000c0001', 'out', 36, CURRENT_DATE - 7,  'REQ-DEMO-018',    'Hana Demo',   'SURABAYA', NULL),
  ('90000000-0000-0000-0000-0000000d0008', '90000000-0000-0000-0000-0000000c0005', 'out', 2,  CURRENT_DATE - 5,  'REQ-DEMO-021',    'Galih Demo',  'MALANG',   'Ganti toner printer lab'),
  ('90000000-0000-0000-0000-0000000d0009', '90000000-0000-0000-0000-0000000c0006', 'out', 8,  CURRENT_DATE - 3,  'REQ-DEMO-023',    'Galih Demo',  'MALANG',   NULL),
  ('90000000-0000-0000-0000-0000000d000a', '90000000-0000-0000-0000-0000000c0004', 'in',  10, CURRENT_DATE - 2,  'PO-DEMO-ATK-004', 'Fitri Demo',  'SURABAYA', 'Cetak kop surat baru')
ON CONFLICT (id) DO NOTHING;

-- ── ATK: opname (satu pas, satu selisih) ──
INSERT INTO atk_stock_opname (id, item_id, opname_date, system_qty, counted_qty, counted_by, cabang, notes) VALUES
  ('90000000-0000-0000-0000-0000000e0001', '90000000-0000-0000-0000-0000000c0003', CURRENT_DATE - 1, 48, 48, 'Krisna Demo', 'SURABAYA', 'Cocok'),
  ('90000000-0000-0000-0000-0000000e0002', '90000000-0000-0000-0000-0000000c0001', CURRENT_DATE - 1, 84, 81, 'Krisna Demo', 'SURABAYA', 'Selisih 3 pcs, dipakai tanpa form')
ON CONFLICT (id) DO NOTHING;

-- ── GA Helpdesk: tiket (kategori 'UMUM' sudah ada dari migrasi) ──
-- status CHECK: open|in_progress|waiting|completed|closed|cancelled
-- priority CHECK: low|medium|high|critical
INSERT INTO ga_tickets (id, ticket_no, title, description, category_id, priority, reporter_name_override,
                        assignee_name_override, location, sla_due_at, status, opened_at, started_at, completed_at, closed_at, rating)
SELECT v.id, v.ticket_no, v.title, v.description, c.id, v.priority, v.reporter, v.assignee, v.location,
       v.sla_due, v.status, v.opened, v.started, v.completed, v.closed, v.rating
FROM (VALUES
  ('90000000-0000-0000-0000-0000000f0001'::uuid, 'GA-DEMO-001', 'AC ruang meeting tidak dingin', 'Sudah dibersihkan filter, tetap kurang dingin.', 'high',     'Fitri Demo',  'Krisna Demo', 'Kantor Surabaya - Lt.2', now() + interval '6 hours',  'in_progress', now() - interval '2 days',  now() - interval '1 day',   NULL,                      NULL,                      NULL::int),
  ('90000000-0000-0000-0000-0000000f0002'::uuid, 'GA-DEMO-002', 'Lampu gudang mati 3 titik',     NULL,                                              'medium',   'Krisna Demo', 'Galih Demo',  'Gudang Surabaya',       now() + interval '18 hours', 'open',        now() - interval '1 day',   NULL,                       NULL,                      NULL,                      NULL),
  ('90000000-0000-0000-0000-0000000f0003'::uuid, 'GA-DEMO-003', 'Kunci laci arsip rusak',        'Perlu ganti silinder kunci.',                     'low',      'Hana Demo',   'Krisna Demo', 'Kantor Surabaya - Lt.1', now() - interval '1 day',    'completed',   now() - interval '6 days',  now() - interval '5 days',  now() - interval '2 days', NULL,                      NULL),
  ('90000000-0000-0000-0000-0000000f0004'::uuid, 'GA-DEMO-004', 'Genset gagal start saat tes',   'Indikator baterai lemah.',                        'critical', 'Galih Demo',  'Krisna Demo', 'Kantor Surabaya',        now() + interval '2 hours',  'waiting',     now() - interval '3 days',  now() - interval '3 days',  NULL,                      NULL,                      NULL),
  ('90000000-0000-0000-0000-0000000f0005'::uuid, 'GA-DEMO-005', 'Permintaan kursi kerja baru',   '2 unit untuk staf baru.',                         'low',      'Julia Demo',  'Fitri Demo',  'Kantor Surabaya - Lt.2', now() - interval '4 days',   'closed',      now() - interval '12 days', now() - interval '11 days', now() - interval '9 days', now() - interval '8 days', 5)
) AS v(id, ticket_no, title, description, priority, reporter, assignee, location, sla_due, status, opened, started, completed, closed, rating)
CROSS JOIN (SELECT id FROM ga_ticket_categories WHERE code = 'UMUM' LIMIT 1) c
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed ATK & GA Helpdesk selesai: 3 kategori, 2 supplier, 6 barang, 10 mutasi, 2 opname, 5 tiket GA.'
