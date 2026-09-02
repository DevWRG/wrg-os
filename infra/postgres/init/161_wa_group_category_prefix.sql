-- 161 — Pra-daftar kategori grup WA berdasarkan AWALAN NAMA. Bot sudah masuk
-- ±27 grup principal/customer (31 Agu 2026) tapi grup-grup itu belum pernah
-- mengirim pesan teks, jadi JID-nya belum diketahui sistem (capture openclaw
-- hanya menulis saat ada inbound message; event "X menambahkan Y" tidak).
-- Tanpa JID, kategori tak bisa dipasang di wa_group_category (PK = group_jid).
--
-- Solusi: pra-daftar per awalan nama. Nama grup di WhatsApp terpotong di UI, dan
-- satu awalan menutup banyak grup sekaligus ('Aftersales Wahana X' → 5 grup),
-- jadi awalan lebih tahan-banting daripada nama persis. Begitu grup dengan nama
-- berawalan ini pertama kali mengirim pesan, kategorinya langsung terpasang.
-- Baris JID-keyed di wa_group_category SELALU menang atas pra-daftar ini, jadi
-- koreksi manual admin tak pernah tertimpa.
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.

CREATE TABLE IF NOT EXISTS wa_group_category_prefix (
  name_prefix text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('principal', 'internal', 'customer')),
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed (2026-09-02): awalan dibaca dari daftar grup WhatsApp milik nomor bot
-- +6285168121906. Pencocokan case-insensitive, awalan TERPANJANG yang menang.
--
-- SENGAJA TIDAK DISEED — identitasnya belum pasti dari nama (terpotong di UI WA),
-- dan menebak di sini berarti salah-kategori yang senyap. Grup-grup ini menunggu
-- terdeteksi sendiri: begitu ada pesan pertama, mereka muncul sebagai "Belum
-- dikategori" dan admin yang memutuskan:
--   KSO KIMIA KLINIK ZYBIO EXC…    (pola 'KSO …' di sini justru customer, tapi
--                                   ZYBIO itu nama brand → ambigu)
--   Koordinasi AdamLIS x WRG       (vendor LIS, bukan principal IVD?)
--   Abhimata - Wahana - Mitrasam…  (grup tiga pihak)
--   PT.WRG & BINTANG MONO
--   Wahana Rizky Gumilang-Inters…
--   PT. Wahana - Direject
--   PT. Wahana Rizky Gumilang - P… (nama terpotong)
INSERT INTO wa_group_category_prefix (name_prefix, category, note) VALUES
  -- Customer: grup layanan/KSO bersama faskes
  ('Aftersales Wahana X',      'customer', NULL),  -- RS Larasati, RSUD M Z…, RSUD S…, RS Suman…, RSI Kalia…
  ('Group KSO PT Wahana X',    'customer', NULL),  -- RS Bh…, Rs Al-…, dll
  ('Group Koo',                'customer', NULL),  -- "Group Koo(rd) PT Wahana X Rsd K…/Rs Wij…"
  ('Group PT Wahana X',        'customer', NULL),  -- Rsi Lumaj…
  ('Wahana |',                 'customer', NULL),  -- RSUD Soedomo, PMI Kota Kediri, RSUD DAHA HUSADA, Pelengkap Medical C…, Muhammadiyah Jo…
  ('KSO alat laboratorium',    'customer', NULL),  -- Rsud Sin… (Rsu Ganesha sudah JID-keyed)
  ('Konsulan Alat Lab',        'customer', NULL),
  ('RSUP BETUN',               'customer', NULL),
  ('RS BHAYANGKARA BATU X',    'customer', NULL),
  -- Principal (hanya yang identitasnya pasti)
  ('Wahana - Snibe',           'principal', 'Snibe'),  -- Snibe = principal IVD, pasti
  -- Internal
  ('TIM WAHANA & INNOVATION',  'internal', NULL)
ON CONFLICT (name_prefix) DO NOTHING;
