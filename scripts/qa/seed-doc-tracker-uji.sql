-- Data uji MANUAL untuk menu Document Tracker (/doc-tracker, migrasi 258) — hanya DB dev lokal.
-- Panduan uji: TESTCASE-DOC-TRACKER.md.
--
-- Membuat 10 Sales Order "UJI-DOC-xx" dengan SJ/pengiriman/faktur yang menghasilkan tiap state dan
-- tiap peringatan. SEMUA id di rentang SEMPIT 9.000.000–9.000.999 dan semua nomor berawalan "UJI-DOC",
-- jadi tak bisa menyentuh data sintetis (id 900.000.000+) atau seed demo (900.001+).
--   ⚠️ Pelajaran 2026-10-27: pembersihan memakai batas terbuka (id >= N) pernah menghapus data sintetis dev.
--      Karena itu pembersihan di bawah memakai BETWEEN dan MENAMPILKAN jumlah barisnya dulu.
--
-- Pakai (DB dev = wrg_os_dev, BUKAN wrg_os):
--   docker exec -i wrg-postgres psql -U wrg -d wrg_os_dev -f - < scripts/qa/seed-doc-tracker-uji.sql
-- Bersihkan:
--   docker exec -i wrg-postgres psql -U wrg -d wrg_os_dev -v hapus=1 -f - < scripts/qa/seed-doc-tracker-uji.sql
--
-- Idempoten: menjalankan seed lagi menghapus fixture lama (rentang sempit) lalu membuatnya ulang, sehingga
-- stempel/checklist/tautan hasil uji sebelumnya ikut kembali ke keadaan awal.
-- Tanggal relatif terhadap hari ini, jadi "BAST 10 hari lalu" selalu 10 hari lalu.

\set ON_ERROR_STOP on

-- ── pembersihan (selalu dijalankan; rentang sempit) ───────────────────────
\echo 'Fixture lama di rentang 9.000.000–9.000.999 (akan dihapus):'
SELECT 'accurate_sales_order' AS tabel, count(*) AS baris FROM accurate_sales_order WHERE id BETWEEN 9000000 AND 9000999
UNION ALL SELECT 'accurate_delivery_order', count(*) FROM accurate_delivery_order WHERE id BETWEEN 9000000 AND 9000999
UNION ALL SELECT 'accurate_invoice', count(*) FROM accurate_invoice WHERE id BETWEEN 9000000 AND 9000999
UNION ALL SELECT 'accurate_customer', count(*) FROM accurate_customer WHERE id BETWEEN 9000000 AND 9000999
UNION ALL SELECT 'shipment_tracking (UJI-DOC-%)', count(*) FROM shipment_tracking WHERE sj_number LIKE 'UJI-DOC-%';

DELETE FROM doc_tracker_faktur   WHERE so_id BETWEEN 9000000 AND 9000999;
DELETE FROM doc_tracker_dokumen  WHERE so_id BETWEEN 9000000 AND 9000999;
DELETE FROM doc_tracker_stamp    WHERE so_id BETWEEN 9000000 AND 9000999;
DELETE FROM shipment_tracking    WHERE sj_number LIKE 'UJI-DOC-%';
DELETE FROM accurate_delivery_order_item WHERE delivery_id BETWEEN 9000000 AND 9000999;
DELETE FROM accurate_delivery_order      WHERE id BETWEEN 9000000 AND 9000999;
DELETE FROM accurate_invoice             WHERE id BETWEEN 9000000 AND 9000999;
DELETE FROM accurate_sales_order         WHERE id BETWEEN 9000000 AND 9000999;
DELETE FROM accurate_customer            WHERE id BETWEEN 9000000 AND 9000999;

\if :{?hapus}
\echo 'Selesai — fixture UJI-DOC dihapus.'
\quit
\endif

-- ── fixture ───────────────────────────────────────────────────────────────
-- Customer: A (id …077) dan B (id …088, untuk uji tautan faktur lintas customer).
INSERT INTO accurate_customer (id, name) VALUES (9000077, 'RS UJI DOC A'), (9000088, 'RS UJI DOC B');

-- SO 01..10 (dibuat 20 hari lalu → "SO lama": Review/Approved tersirat bila tahap hilir ada).
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, customer_id)
SELECT 9000000 + i, 'UJI-DOC-' || lpad(i::text, 2, '0'), CURRENT_DATE - 20, 'RS UJI DOC A', 'OPEN', 1000000 * i, 9000077
FROM generate_series(1, 10) i;

-- SJ (DO + item yang menautkan ke SO) dan pengiriman.  helper: (so, nomor SJ, kirim, terima, bast) = "hari lalu" / NULL.
CREATE TEMP TABLE _sj (so int, k int, kirim int, terima int, bast int);
INSERT INTO _sj VALUES
  (2, 1, NULL, NULL, NULL),   -- 02: SJ terbit, belum dikirim            → Draft (SJ 1, kirim 0)
  (3, 1, 10,   NULL, NULL),   -- 03: dikirim                              → Sent
  (4, 1, 10,   9,    NULL),   -- 04: diterima customer                    → Received
  (5, 1, 12,   11,   10),     -- 05: BAST 10 hari lalu, tanpa faktur      → Executed + BERISIKO DITAGIH
  (6, 1, 3,    2,    1),      -- 06: BAST 1 hari lalu, tanpa faktur       → Executed, tidak berisiko
  (7, 1, 12,   11,   10),     -- 07: BAST 10 hari lalu, faktur belum ditautkan → Executed + BERISIKO sampai ditautkan (uji tautan di UI)
  (8, 1, 12,   11,   10),     -- 08: BAST + faktur lunas tertaut          → Paid (dokumen belum lengkap)
  (9, 1, 12,   11,   10),     -- 09: kirim bertahap: SJ-1 BAST,
  (9, 2, 4,    NULL, NULL),   --                     SJ-2 dikirim,
  (9, 3, NULL, NULL, NULL),   --                     SJ-3 belum dikirim → progres, bukan anomali
  (10, 1, 12,  11,   NULL);   -- 10: diterima + faktur tertaut tanpa BAST → ANOMALI

INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, status)
SELECT 9000000 + so * 10 + k, 'UJI-DOC-SJ-' || lpad(so::text, 2, '0') || '-' || k, CURRENT_DATE - 15, 'RS UJI DOC A', 'OPEN' FROM _sj;
INSERT INTO accurate_delivery_order_item (delivery_id, line_no, item_no, item_name, qty, sales_order_id)
SELECT 9000000 + so * 10 + k, 1, 'UJI-ITEM', 'Item uji', 1, 9000000 + so FROM _sj;
INSERT INTO shipment_tracking (sj_number, customer_name, status, kirim_at, terima_at, bast_at, created_by)
SELECT 'UJI-DOC-SJ-' || lpad(so::text, 2, '0') || '-' || k, 'RS UJI DOC A',
       CASE WHEN bast IS NOT NULL THEN 'bast' WHEN terima IS NOT NULL THEN 'terima' WHEN kirim IS NOT NULL THEN 'dikirim' ELSE 'draft' END,
       now() - kirim * interval '1 day', now() - terima * interval '1 day', now() - bast * interval '1 day', 'uji-doc'
FROM _sj;

-- Faktur. 507: kandidat tautan untuk SO 07 (belum tertaut). 508: lunas, tertaut ke SO 08. 510: belum lunas, tertaut ke SO 10.
-- 599: milik customer B → TIDAK boleh muncul sebagai kandidat SO milik customer A, dan tautannya harus ditolak (409).
INSERT INTO accurate_invoice (id, number, customer_id, tanggal, total, paid, outstanding, status, lunas_at) VALUES
  (9000507, 'UJI-DOC-F-07', 9000077, CURRENT_DATE - 8, 7000000, 0,       7000000, 'UNPAID', NULL),
  (9000508, 'UJI-DOC-F-08', 9000077, CURRENT_DATE - 8, 8000000, 8000000, 0,       'PAID',   CURRENT_DATE - 3),
  (9000510, 'UJI-DOC-F-10', 9000077, CURRENT_DATE - 8, 10000000, 0,      10000000, 'UNPAID', NULL),
  (9000599, 'UJI-DOC-F-B',  9000088, CURRENT_DATE - 8, 5000000, 0,       5000000, 'UNPAID', NULL);
INSERT INTO doc_tracker_faktur (so_id, invoice_id, by) VALUES (9000008, 9000508, 'seed-uji'), (9000010, 9000510, 'seed-uji');

\echo 'Fixture UJI-DOC dibuat. State yang diharapkan (mode default, SO lama):'
\echo '  01 Draft | 02 Draft (SJ 1, kirim 0) | 03 Sent | 04 Received | 05 Executed + berisiko | 06 Executed'
\echo '  07 Executed + berisiko (sampai faktur ditautkan) | 08 Paid | 09 Approved (kirim 2 dari 3 SJ) | 10 Received + 1 dokumen kurang'
