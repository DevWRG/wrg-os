-- seed-cek-dev.sql — data SINTETIS untuk trial lokal command WA `#CEK CUSTOMER`
-- (QW3). Idempoten: aman dijalankan berulang. Pakai id PK tinggi (900010+,
-- di luar range 900001-900002 yang sudah dipakai seed-dev.sql) supaya tak
-- bentrok dengan data prod/legacy maupun seed lain.
--
--   psql "$DATABASE_URL" -f scripts/db/seed-cek-dev.sql
--
-- Lihat docs/LOCAL-DEV.md bagian "Trial #CEK CUSTOMER (QW3)" untuk alur
-- lengkapnya (aktifkan WA_INBOUND_PROCESS, kirim command, baca balasan).

BEGIN;

-- ── PT Testing — kasus dasar, SO+SJ lengkap ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900010, 'SO-TEST-001', CURRENT_DATE - 3, 'PT Testing', 'Open', 45000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900011, 'SJ-TEST-001', CURRENT_DATE - 1, 'PT Testing', 'Gudang Uji', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── RS Mitra Keluarga — nama lebih realistis, SO+SJ lengkap ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900012, 'SO-2026-0801', CURRENT_DATE - 6, 'RS Mitra Keluarga', 'Open', 120000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900013, 'SJ-2026-0801', CURRENT_DATE - 2, 'RS Mitra Keluarga', 'Gudang RS Mitra Keluarga', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── PT Hanya SO — cuma ada di sales-order (uji "Belum ada SJ tercatat") ──
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900014, 'SO-TEST-002', CURRENT_DATE - 4, 'PT Hanya SO', 'Open', 8500000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── PT Hanya SJ — cuma ada di delivery-order (uji "Belum ada SO tercatat") ──
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900015, 'SJ-TEST-002', CURRENT_DATE - 1, 'PT Hanya SJ', 'Gudang B', 'Delivered', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── CV Sample Satu / CV Sample Dua — dua customer BEDA dengan nama sangat
-- mirip. Sengaja untuk mendemonstrasikan known limitation: SO & SJ dicocokkan
-- independen via similarity() > 0.3 (lihat TECHNICAL.md / PR #868), jadi
-- "#CEK CUSTOMER CV Sample Dua" bisa ikut menampilkan SO milik "CV Sample
-- Satu" (nyasar) — bukan bug baru, cuma demonstrasi risiko fuzzy-match.
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw) VALUES
  (900016, 'SO-TEST-003', CURRENT_DATE - 5, 'CV Sample Satu', 'Closed', 2000000, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to, status, raw) VALUES
  (900017, 'SJ-TEST-003', CURRENT_DATE - 2, 'CV Sample Dua', 'Gudang C', 'Shipped', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed cek-dev selesai: 5 customer dummy (PT Testing, RS Mitra Keluarga, PT Hanya SO, PT Hanya SJ, CV Sample Satu/Dua) di accurate_sales_order/accurate_delivery_order.'
