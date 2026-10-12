-- 158 — F13 PO Tracker fix: po_number tidak unik (BUG-06, sesi QA jalur
-- tulis magang 2026-08-28). Skema awal (143_purchase_order.sql) cuma
-- `po_number text NOT NULL` tanpa constraint unik apa pun — dua PO dgn
-- nomor identik bisa dibuat lewat POST /purchase-orders berulang, app-layer
-- tak pernah cek duplikat sebelum INSERT.
--
-- Fix: unique index di level DB (pola sama atk_category_name_key/print_spec)
-- supaya duplikat ditolak DB, bukan cuma harapan app-layer. Global (semua PO
-- termasuk yang cancelled_at terisi) -- BUG-06 cuma soal "duplikat bisa
-- dibuat", bukan soal apakah nomor PO yang dibatalkan boleh dipakai ulang;
-- pengecualian utk PO cancelled sengaja tak ditambahkan di sini (di luar
-- scope BUG-06, keputusan bisnis terpisah kalau dibutuhkan nanti).

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_po_number_key ON purchase_order (po_number);

COMMENT ON INDEX purchase_order_po_number_key IS
  'BUG-06 (sesi QA jalur tulis magang 2026-08-28): po_number wajib unik global — sebelumnya dua PO bisa punya nomor identik.';
