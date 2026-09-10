-- seed-cek-dev.sql — data SINTETIS untuk trial lokal command WA `#CEK CUSTOMER`
-- (QW3, #868). Idempoten: aman dijalankan berulang. Pakai id PK tinggi (900010+,
-- di luar range 900001-900002 yang sudah dipakai seed-dev.sql) supaya tak
-- bentrok dengan data prod/legacy maupun seed lain.
--
--   psql "$DATABASE_URL" -f scripts/db/seed-cek-dev.sql
--
-- Lihat docs/LOCAL-DEV.md bagian "Trial #CEK CUSTOMER (QW3)" untuk alur
-- lengkapnya (aktifkan WA_INBOUND_PROCESS, kirim command, baca balasan di log
-- server — lihat section #1042 di atasnya).
--
-- Butuh migrasi 162 (`accurate_sales_order.customer_id` / `..._delivery_order`)
-- sudah jalan — seed ini menautkan tiap dokumen ke `accurate_customer`, persis
-- seperti data Accurate sungguhan.
--
-- ── Kenapa nama-nama ini, bukan nama lain (jangan diganti sembarangan) ──
-- Nama antar-kasus yang mirip bisa saling mencuri hasil: kalau kasus "cuma SO"
-- dan "cuma SJ" diberi nama beda satu-dua huruf, baris "Belum ada SJ tercatat"
-- tak akan pernah muncul. Sebelum commit, similarity() dicek EMPIRIS (bukan
-- diasumsikan) utk keenam nama:
--
--   SELECT a.name, b.name, similarity(a.name, b.name)
--   FROM (VALUES ('PT Testing'),('PT Alpha Order'),('CV Beta Kirim'),
--                ('RS Sehat Sentosa'),('CV Sample Satu'),('CV Sample Dua')) a(name)
--   CROSS JOIN (...) b(name) WHERE a.name < b.name ORDER BY 3 DESC;
--
-- Hasil: SEMUA pasangan < 0.13, KECUALI "CV Sample Dua" vs "CV Sample Satu"
-- (0.588) — pasangan itu SENGAJA di atas threshold, lihat kasus #5 di bawah.
-- Kalau nama diganti, ulangi verifikasi ini sebelum commit — jangan asumsi.

BEGIN;

-- ── Master customer — sumber identitas yang di-resolve DULUAN oleh
-- handleCekQuery() sebelum SO/SJ diambil. Tanpa baris ini seed cuma menguji
-- jalur fallback (nama dari SO/SJ), bukan jalur normal. ──
INSERT INTO accurate_customer (id, no, name, raw) VALUES
  (900020, 'C-TEST-001', 'PT Testing',       '{}'::jsonb),
  (900021, 'C-TEST-002', 'RS Sehat Sentosa', '{}'::jsonb),
  (900022, 'C-TEST-003', 'PT Alpha Order',   '{}'::jsonb),
  (900023, 'C-TEST-004', 'CV Beta Kirim',    '{}'::jsonb),
  (900024, 'C-TEST-005', 'CV Sample Satu',   '{}'::jsonb),
  (900025, 'C-TEST-006', 'CV Sample Dua',    '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── #1 PT Testing — kasus dasar, SO+SJ lengkap ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900010, 'SO-TEST-001', CURRENT_DATE - 3, 'PT Testing', 'Open', 45000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900011, 'SJ-TEST-001', CURRENT_DATE - 1, 'PT Testing', 'Gudang Uji', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── #4 RS Sehat Sentosa — sama seperti #1, nama lebih realistis ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900012, 'SO-2026-0801', CURRENT_DATE - 6, 'RS Sehat Sentosa', 'Open', 120000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900013, 'SJ-2026-0801', CURRENT_DATE - 2, 'RS Sehat Sentosa', 'Gudang RS Sehat Sentosa', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── #2 PT Alpha Order — cuma ada di sales-order (uji "→ Belum ada SJ tercatat") ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900014, 'SO-TEST-002', CURRENT_DATE - 4, 'PT Alpha Order', 'Open', 8500000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── #3 CV Beta Kirim — cuma ada di delivery-order (uji "📋 Belum ada SO tercatat") ──
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900015, 'SJ-TEST-002', CURRENT_DATE - 1, 'CV Beta Kirim', 'Gudang B', 'Delivered', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── #5 CV Sample Satu (SO) / CV Sample Dua (SJ) — dua CUSTOMER BEDA dengan
-- nama SENGAJA mirip (similarity 0.588, lihat catatan di atas). Dulu ini bukti
-- hidup dari kebocoran lintas-customer (PR #868): "#CEK CUSTOMER CV Sample Dua"
-- membalas header "CV Sample Satu" karena SO-nya menang skor similarity.
-- Sekarang jadi FIXTURE REGRESI dari perbaikan issue #839 — yang benar:
--   #CEK CUSTOMER CV Sample Dua  → header "CV Sample Dua", SJ-TEST-003,
--                                  "📋 Belum ada SO tercatat" (SO milik "Satu"
--                                  TIDAK boleh ikut muncul)
--   #CEK CUSTOMER CV Sample Satu → header "CV Sample Satu", SO-TEST-003,
--                                  "→ Belum ada SJ tercatat"
--   #CEK CUSTOMER CV Sample      → balasan AMBIGU: daftar kedua nama, tidak
--                                  memilih salah satu
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900016, 'SO-TEST-003', CURRENT_DATE - 5, 'CV Sample Satu', 'Closed', 2000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900017, 'SJ-TEST-003', CURRENT_DATE - 2, 'CV Sample Dua', 'Gudang C', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Tautkan dokumen ke customernya. Ditulis sbg UPDATE terpisah (bukan kolom
-- di INSERT) supaya seed yang SUDAH pernah dijalankan sebelum migrasi 162 ikut
-- diperbaiki — `ON CONFLICT DO NOTHING` di atas tak akan menyentuh baris lama. ──
UPDATE accurate_sales_order    SET customer_id = 900020 WHERE id = 900010;
UPDATE accurate_delivery_order SET customer_id = 900020 WHERE id = 900011;
UPDATE accurate_sales_order    SET customer_id = 900021 WHERE id = 900012;
UPDATE accurate_delivery_order SET customer_id = 900021 WHERE id = 900013;
UPDATE accurate_sales_order    SET customer_id = 900022 WHERE id = 900014;
UPDATE accurate_delivery_order SET customer_id = 900023 WHERE id = 900015;
UPDATE accurate_sales_order    SET customer_id = 900024 WHERE id = 900016;
UPDATE accurate_delivery_order SET customer_id = 900025 WHERE id = 900017;

COMMIT;

\echo 'Seed cek-dev selesai: 6 customer + 5 kasus (PT Testing, RS Sehat Sentosa, PT Alpha Order, CV Beta Kirim, CV Sample Satu/Dua) di accurate_customer/accurate_sales_order/accurate_delivery_order.'
