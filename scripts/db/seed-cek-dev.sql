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
-- ── Kenapa nama-nama ini, bukan nama lain (jangan diganti sembarangan) ──
-- Query SO dan SJ di handleCekQuery() jalan INDEPENDEN, masing-masing
-- `ORDER BY score DESC LIMIT 1` (apps/api/src/repo/inbound-cek.ts:43-57,
-- threshold CEK_MATCH=0.3 di baris 24). Nama antar-kasus yang mirip akan
-- saling mencuri hasil satu sama lain: kalau kasus "cuma SO" dan "cuma SJ"
-- diberi nama beda satu-dua huruf, query kasus pertama akan menarik SJ milik
-- kasus kedua — baris "Belum ada SJ tercatat" tak akan pernah muncul. Sebelum
-- commit, similarity() dicek EMPIRIS (bukan diasumsikan) utk kelima nama:
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
-- nama SENGAJA mirip (similarity 0.588, lihat catatan di atas). Mendemonstrasikan
-- known limitation fuzzy-match SO/SJ independen (PR #868,
-- docs/features/F4-cek-faktur-so-sj-cross-ref.md): "#CEK CUSTOMER CV Sample Dua"
-- akan balas header "CV Sample Satu" krn SO-nya menang skor similarity — bukan
-- bug, ini bukti hidup dari limitation yang sudah didokumentasikan.
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900016, 'SO-TEST-003', CURRENT_DATE - 5, 'CV Sample Satu', 'Closed', 2000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900017, 'SJ-TEST-003', CURRENT_DATE - 2, 'CV Sample Dua', 'Gudang C', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed cek-dev selesai: 5 kasus (PT Testing, RS Sehat Sentosa, PT Alpha Order, CV Beta Kirim, CV Sample Satu/Dua) di accurate_sales_order/accurate_delivery_order.'
