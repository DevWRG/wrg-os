-- Seed dev-only F53 (Stiker Aset & Asset Tagging Audit) — data contoh utk
-- testing lokal. BUKAN data produksi. Idempoten (upsert by kode).
-- Contoh diambil dari data referensi tool sebelumnya (github.com/DevWRG/label-asset).

INSERT INTO asset_tag (kode, nama, jenis_kepemilikan, kategori, lokasi_cabang, letak) VALUES
  ('WRG-KMG-FRN-001', 'Rak Besi Susun',     'inventaris', 'Furniture',  'Gudang Kemangi', 'Lantai 1'),
  ('WRG-KMG-ELK-001', 'CCTV Camera',        'inventaris', 'Elektronik', 'Gudang Kemangi', 'Parkiran'),
  ('WRG-KMG-PLK-001', 'Genset 5500W',       'aset',       'Pelengkap',  'Gudang Kemangi', 'Parkiran'),
  ('WRG-KMG-FRN-002', 'Meja Packing',       'inventaris', 'Furniture',  'Gudang Kemangi', 'Lantai 1'),
  ('WRG-KMG-ELK-002', 'Laptop Lenovo',      'aset',       'Elektronik', 'Gudang Kemangi', 'Ruang Adm'),
  ('WRG-PST-FRN-001', 'Meja Kayu Besar',    'aset',       'Furniture',  'Kantor Pusat',   'Ruang HRGA'),
  ('WRG-PST-ELK-001', 'Proyektor Epson',    'aset',       'Elektronik', 'Kantor Pusat',   'Ruang Meeting'),
  ('WRG-MDN-ELK-001', 'AC Split 1PK',       'aset',       'Elektronik', 'Madiun',         'Ruang Tamu')
ON CONFLICT (kode) DO UPDATE SET
  nama = EXCLUDED.nama, jenis_kepemilikan = EXCLUDED.jenis_kepemilikan,
  kategori = EXCLUDED.kategori, lokasi_cabang = EXCLUDED.lokasi_cabang, letak = EXCLUDED.letak;

-- 2 entri audit contoh: 1 ditemukan, 1 tidak ditemukan (demo badge merah).
INSERT INTO asset_tag_audit_log (asset_tag_id, audited_by, found, note)
SELECT id, 'Husni', true, 'Kondisi baik, label QR masih terbaca'
FROM asset_tag a WHERE a.kode = 'WRG-KMG-FRN-001'
  AND NOT EXISTS (SELECT 1 FROM asset_tag_audit_log t WHERE t.asset_tag_id = a.id);

INSERT INTO asset_tag_audit_log (asset_tag_id, audited_by, found, note)
SELECT id, 'Dito', false, 'Tidak ditemukan saat sidak gudang, dicari ulang'
FROM asset_tag a WHERE a.kode = 'WRG-KMG-ELK-002'
  AND NOT EXISTS (SELECT 1 FROM asset_tag_audit_log t WHERE t.asset_tag_id = a.id);
