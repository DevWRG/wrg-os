-- Seed dev-only F52 (Tiket IT) — data contoh utk testing lokal. BUKAN data
-- produksi, jangan dijalankan ke wrg_os_prod. Idempoten (upsert by asset_code
-- / dihapus-insert ulang by masalah unik dev-only).
--
-- Master aset (ga_asset_categories + ga_assets) F52 diserap ke sini krn F52
-- diserap F132 — seed kategori "Elektronik" dulu kalau belum ada.

INSERT INTO ga_asset_categories (code, nama, depreciation_years, icon) VALUES
  ('AST-ELK', 'Elektronik', 5, '💻')
ON CONFLICT (code) DO UPDATE SET nama = EXCLUDED.nama;

INSERT INTO ga_assets (asset_code, nama, category_id, location, pic_name_override, is_critical) VALUES
  ('PC-FAK-01', 'PC Fakturis 1',   (SELECT id FROM ga_asset_categories WHERE code = 'AST-ELK'), 'Ruang Fakturis', 'Sari',  true),
  ('PC-FAK-02', 'PC Fakturis 2',   (SELECT id FROM ga_asset_categories WHERE code = 'AST-ELK'), 'Ruang Fakturis', 'Sari',  true),
  ('PC-ADM-01', 'PC Admin Gudang', (SELECT id FROM ga_asset_categories WHERE code = 'AST-ELK'), 'Gudang',         'Yugi',  false),
  ('LT-SLS-01', 'Laptop Sales 1',  (SELECT id FROM ga_asset_categories WHERE code = 'AST-ELK'), NULL,             NULL,    false),
  ('PC-GA-01',  'PC Resepsionis',  (SELECT id FROM ga_asset_categories WHERE code = 'AST-ELK'), 'Lobby',          'Dito',  false)
ON CONFLICT (asset_code) DO UPDATE SET
  nama = EXCLUDED.nama, location = EXCLUDED.location, pic_name_override = EXCLUDED.pic_name_override, is_critical = EXCLUDED.is_critical;

-- 3 tiket contoh: 1 kritis lewat SLA (demo alert), 1 normal berjalan, 1 selesai.
-- `it_ticket.id` random (gen_random_uuid), jadi idempotensi dijaga via
-- NOT EXISTS per `masalah` per aset, bukan ON CONFLICT (tak ada unique key
-- alami di sini utk itu).
INSERT INTO it_ticket (asset_id, masalah, status, reported_by, assigned_to, sla_due_at, resolved_at, resolved_note)
SELECT a.id, 'Tidak bisa nyala sejak pagi', 'open', 'Sari', 'Dito', now() - interval '3 hours', NULL, NULL
FROM ga_assets a WHERE a.asset_code = 'PC-FAK-01'
  AND NOT EXISTS (SELECT 1 FROM it_ticket t WHERE t.asset_id = a.id AND t.masalah = 'Tidak bisa nyala sejak pagi');

INSERT INTO it_ticket (asset_id, masalah, status, reported_by, assigned_to, sla_due_at, resolved_at, resolved_note)
SELECT a.id, 'Mouse tidak terdeteksi', 'in_progress', 'Yugi', 'Husni', now() + interval '18 hours', NULL, NULL
FROM ga_assets a WHERE a.asset_code = 'PC-ADM-01'
  AND NOT EXISTS (SELECT 1 FROM it_ticket t WHERE t.asset_id = a.id AND t.masalah = 'Mouse tidak terdeteksi');

INSERT INTO it_ticket (asset_id, masalah, status, reported_by, assigned_to, sla_due_at, resolved_at, resolved_note)
SELECT a.id, 'Baterai laptop drop cepat', 'resolved', 'Budi', 'Dito', now() - interval '2 days', now() - interval '1 day', 'Baterai diganti'
FROM ga_assets a WHERE a.asset_code = 'LT-SLS-01'
  AND NOT EXISTS (SELECT 1 FROM it_ticket t WHERE t.asset_id = a.id AND t.masalah = 'Baterai laptop drop cepat');
