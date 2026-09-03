-- 162 — Tautkan mirror Sales Order & Delivery Order ke customer sungguhan.
--
-- MASALAH: 036/037 hanya menyimpan `customer_name text`, padahal respons Accurate
-- membawa objek customer utuh dan `accurateSync.ts` sudah menyimpannya apa adanya
-- ke kolom `raw` (jsonb). Akibatnya fitur hilir (mis. Shipment Tracking) cuma bisa
-- menyalin NAMA sebagai teks, tak pernah menautkan ke `accurate_customer`.
--
-- Sudah diverifikasi di DB prod (2026-09-03):
--   accurate_sales_order   : 3.598 baris, 3.598 punya raw->'customer'->>'id', 498 customer unik, 0 id yatim
--   accurate_delivery_order: 3.541 baris, 3.541 punya raw->'customer'->>'id', 472 customer unik, 0 id yatim
--   customer_name tersimpan == accurate_customer.name untuk 3.598 baris (0 beda, 0 kosong)
-- Jadi backfill bisa dikerjakan LANGSUNG dari `raw` — tanpa memanggil API Accurate
-- dan tanpa menunggu siklus sync berikutnya.
--
-- Pola ikut migrasi 159 (dipakai F22): HYBRID — FK baru NULLABLE, kolom teks
-- `customer_name` DIPERTAHANKAN sebagai snapshot historis, bukan diganti.
-- Nullable meski data sekarang 100% lengkap: baris masa depan dari respons
-- Accurate yang tak normal tak boleh memblokir sync.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.

ALTER TABLE accurate_sales_order
  ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES accurate_customer (id) ON DELETE SET NULL;
ALTER TABLE accurate_delivery_order
  ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES accurate_customer (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS accurate_sales_order_customer_idx    ON accurate_sales_order (customer_id);
CREATE INDEX IF NOT EXISTS accurate_delivery_order_customer_idx ON accurate_delivery_order (customer_id);

-- Backfill dari raw. Guard `IN (SELECT id FROM accurate_customer)` dipasang meski
-- prod terbukti 0 yatim: mirror customer bisa tertinggal di environment lain
-- (dev/demo di-seed sebagian), dan tanpa guard ini FK-nya akan menolak UPDATE.
UPDATE accurate_sales_order SET customer_id = (raw->'customer'->>'id')::bigint
 WHERE customer_id IS NULL
   AND raw->'customer' ? 'id'
   AND (raw->'customer'->>'id') ~ '^[0-9]+$'
   AND (raw->'customer'->>'id')::bigint IN (SELECT id FROM accurate_customer);

UPDATE accurate_delivery_order SET customer_id = (raw->'customer'->>'id')::bigint
 WHERE customer_id IS NULL
   AND raw->'customer' ? 'id'
   AND (raw->'customer'->>'id') ~ '^[0-9]+$'
   AND (raw->'customer'->>'id')::bigint IN (SELECT id FROM accurate_customer);
