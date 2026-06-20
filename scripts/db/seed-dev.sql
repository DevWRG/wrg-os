-- seed-dev.sql — data SINTETIS kecil untuk trial lokal (bukan dump prod).
-- Idempoten: aman dijalankan berulang. Pakai am_id ber-prefix 'demo' + id PK
-- tinggi (>=900000) supaya tak bentrok dengan data prod/legacy (am_id 1..63).
--
--   psql "$DATABASE_URL" -f scripts/db/seed-dev.sql
--
-- Catatan: user login TIDAK di-seed di sini (password = scrypt, dibuat aplikasi).
-- Bikin admin via: POST /auth/register saat DB belum ada user (bootstrap).

BEGIN;

-- ── Master user (AM demo) ──
INSERT INTO master_user (am_id, nama, panggilan, role, cabang, aktif, wajib_plan_report) VALUES
  ('demo1', 'Budi Demo',  'Budi',  'AM',  'Demo', TRUE, TRUE),
  ('demo2', 'Sari Demo',  'Sari',  'AM',  'Demo', TRUE, TRUE),
  ('demo3', 'Andi Demo',  'Andi',  'HOD', 'Demo', TRUE, TRUE)
ON CONFLICT (am_id) DO NOTHING;

-- ── Sales plan demo1 hari ini (2 rencana kunjungan) ──
INSERT INTO sales_plan (id, am_id, tanggal, customer_name, tujuan, goal, seq, submitted_at) VALUES
  (900001, 'demo1', CURRENT_DATE, 'RS Demo Sehat',   'Follow-up tender alkes',  'Closing PO', 1, NOW()),
  (900002, 'demo1', CURRENT_DATE, 'Klinik Demo Jaya', 'Penawaran reagen lab',   'Demo produk', 2, NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Activity log demo1 (lapor 1 dari 2 plan → partial, kelihatan di dashboard) ──
INSERT INTO activity_log (id, am_id, plan_id, tanggal, customer_name, tujuan, hasil, source) VALUES
  (900001, 'demo1', 900001, CURRENT_DATE, 'RS Demo Sehat', 'Follow-up tender alkes',
   'Bertemu kabag pengadaan, tender lanjut minggu depan', 'seed-dev')
ON CONFLICT (id) DO NOTHING;
UPDATE sales_plan SET reported = TRUE, reported_at = NOW(), activity_id = 900001
  WHERE id = 900001 AND reported = FALSE;

-- ── Sales todo demo2 (sudah report) ──
INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, reported, reported_at)
SELECT 'demo2', 'Sari Demo', CURRENT_DATE,
       '["proses faktur RS Demo","input data customer baru"]'::jsonb,
       '#Report Sari\n1. proses faktur RS Demo - selesai\n2. input data customer baru - selesai',
       TRUE, NOW()
WHERE NOT EXISTS (SELECT 1 FROM sales_todo WHERE am_id = 'demo2' AND tanggal = CURRENT_DATE);

COMMIT;

\echo 'Seed dev selesai: 3 AM demo (demo1/demo2/demo3), 2 plan + 1 activity (demo1), 1 todo (demo2).'
