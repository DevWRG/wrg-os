-- 160 — Kategori grup WhatsApp (principal / internal / customer). Dipakai
-- halaman Monitor → Pola Komunikasi untuk memfilter galeri grup. Kategori
-- adalah properti GRUP, bukan properti profil pola, jadi tabel terpisah:
-- job pola-komunikasi meng-upsert monitor_pola tiap malam (group_name+content)
-- dan tak boleh menimpa kategori yang di-set manual admin.
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.

CREATE TABLE IF NOT EXISTS wa_group_category (
  group_jid  varchar(120) PRIMARY KEY,
  category   text NOT NULL CHECK (category IN ('principal', 'internal', 'customer')),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_group_category_category_idx ON wa_group_category (category);

-- Seed awal (2026-09-02): hasil klasifikasi dari profil monitor_pola + sampel
-- wa_message. ON CONFLICT DO NOTHING → seed TIDAK menimpa koreksi manual admin.
-- Nama grup diambil dari subject sessions.json openclaw (monitor_pola.group_name
-- untuk 1527497998 terbukti basi). 'RAFA Group 🤝 Wahana LifeLine'
-- (120363422805054875) SENGAJA tak diseed — belum jelas principal atau customer.
INSERT INTO wa_group_category (group_jid, category, note) VALUES
  -- Divisi / kantor
  ('6281335118687-1526342601@g.us', 'internal', 'ADMIN PENJ., GUDANG & KEU'),
  ('120363215877961952@g.us',       'internal', 'Accounting & Purchasing WRG'),
  ('120363406071725731@g.us',       'internal', 'WRG - Accounting & Tax'),
  ('6282232418991-1555990746@g.us', 'internal', 'FINANCE & TAX WRG'),
  ('120363403842555552@g.us',       'internal', 'GA WRG'),
  ('6281232432442-1524412509@g.us', 'internal', 'HRD WG GROUP 2026'),
  ('120363048384809457@g.us',       'internal', 'Pengumuman HR WGI'),
  ('6281248476085-1530485384@g.us', 'internal', 'PLAN PURCHASING WRG'),
  ('6285736763141-1515408009@g.us', 'internal', 'INFO PEMBAYARAN -FAKTURIS'),
  -- Support / teknis
  ('6281949637972-1523701417@g.us', 'internal', 'GROUP ECATALOG SUPPORT'),
  ('6281949637972-1523701186@g.us', 'internal', 'GROUP MAINTENANCE SUPPORT'),
  ('6285649096261-1516620137@g.us', 'internal', 'GROUP INFO HARGA & LPSE'),
  ('6281335118687-1517798430@g.us', 'internal', 'GROUP TRAINING KRM-TAGIH'),
  ('6281335118687-1527497998@g.us', 'internal', 'PENJUALAN SOLO-JOGJA-PWT (label monitor_pola basi)'),
  -- Manajemen / tim
  ('120363042143432430@g.us',       'internal', 'HOD Squad'),
  ('120363404092121926@g.us',       'internal', 'Koord HoD'),
  ('120363405485256544@g.us',       'internal', 'The ALLIANCE'),
  ('120363225099430838@g.us',       'internal', 'The Ironman Team 2026'),
  ('120363397960052940@g.us',       'internal', 'THE SUPERMAN TIM 2026'),
  ('120363429871906530@g.us',       'internal', 'WRG OS Development'),
  ('120363409252019573@g.us',       'internal', 'Research (grup trial bot)'),
  ('6281949637972-1609892332@g.us', 'internal', 'PENJUALAN KALIMANTAN'),
  -- Penjualan cabang & regional
  ('6281335118687-1527496546@g.us', 'internal', 'PENJUALAN CAB. JEMBER'),
  ('6281335118687-1527494977@g.us', 'internal', 'PENJUALAN CAB. KEDIRI'),
  ('6281335118687-1527495664@g.us', 'internal', 'PENJUALAN CAB. MADIUN'),
  ('6281248476085-1539641961@g.us', 'internal', 'PENJUALAN CAB. MADURA'),
  ('6281949637972-1609891981@g.us', 'internal', 'PENJUALAN CAB. TUBAN'),
  ('120363405145265597@g.us',       'internal', 'PENJUALAN DISTRIBUTOR'),
  ('6281949637972-1603758195@g.us', 'internal', 'PENJUALAN JAKARTA-BANTEN'),
  ('6281949637972-1609761547@g.us', 'internal', 'PENJUALAN JAWA BARAT'),
  ('6281335118687-1527496248@g.us', 'internal', 'PENJUALAN MALANG'),
  ('6281949637972-1609891850@g.us', 'internal', 'PENJUALAN PROV. BALI'),
  ('6281335118687-1527497732@g.us', 'internal', 'PENJUALAN PROV. NTT NTB'),
  ('6281949637972-1609892156@g.us', 'internal', 'PENJUALAN SEMARANG KUDUS'),
  ('6281335118687-1527497274@g.us', 'internal', 'PENJUALAN SURABAYA'),
  -- Principal (grup gabungan dengan pemegang brand)
  ('120363409228589457@g.us',       'principal', 'Wahana - Snibe'),
  -- Customer (grup gabungan dengan faskes)
  ('120363403539602123@g.us',       'customer', 'Konsulan Alat Lab RSW-Wahana — LAB RSU Wonolangan'),
  ('120363406765586789@g.us',       'customer', 'Wahana | HVA Toeloengredjo Pare'),
  ('120363407577614905@g.us',       'customer', 'KSO alat laboratorium RSU Ganesha X Wahana')
ON CONFLICT (group_jid) DO NOTHING;
