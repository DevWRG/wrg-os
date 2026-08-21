-- 096 — Tautan baris DO → baris SO, supaya fill rate bisa dihitung per pesanan.
--
-- Fill rate lama (migrasi 081 / #846) membandingkan sum(qty) SO dan sum(qty) DO
-- dalam BULAN YANG SAMA, tanpa menautkan pengiriman ke pesanannya:
--   ordered  = sum qty SO bulan ini
--   delivered= sum qty DO bulan ini
-- Rasio itu terdistorsi pesanan lintas bulan — kiriman awal Agustus atas pesanan
-- akhir Juli menaikkan angka, pesanan akhir Agustus yang dikirim September
-- menurunkannya — dan tak bisa menjawab "kenapa 82%?" karena tak bisa ditelusuri
-- sampai SO mana yang kurang.
--
-- Payload detail.do delivery-order ternyata SUDAH memuat tautannya di tiap baris:
-- salesOrderId + salesOrderDetailId. Terukur di prod 2026-08-13: terisi pada
-- 5.848/5.848 baris (100%), dan 5.782 di antaranya (98,9%) ketemu pasangannya di
-- accurate_sales_order_item. Sisanya merujuk SO lebih tua dari jendela mirror.
--
-- Sesuai prinsip migrasi 081 ("hanya field yang jalur bacanya sudah terbukti"),
-- ketiganya diangkat dari `raw` jadi kolom sungguhan + indeks. `raw` tetap utuh.

ALTER TABLE accurate_delivery_order_item
  ADD COLUMN IF NOT EXISTS sales_order_id        bigint,
  ADD COLUMN IF NOT EXISTS sales_order_detail_id bigint;

-- id baris detail versi Accurate. PK kita (order_id, line_no) tidak bisa dipakai
-- sebagai sasaran tautan karena line_no diturunkan dari urutan, bukan dari Accurate.
ALTER TABLE accurate_sales_order_item
  ADD COLUMN IF NOT EXISTS line_id bigint;

-- Backfill dari raw yang sudah tersimpan — tak perlu tarik ulang dari Accurate.
UPDATE accurate_delivery_order_item
   SET sales_order_id        = NULLIF(raw->>'salesOrderId','')::bigint,
       sales_order_detail_id = NULLIF(raw->>'salesOrderDetailId','')::bigint
 WHERE raw IS NOT NULL AND sales_order_detail_id IS NULL;

UPDATE accurate_sales_order_item
   SET line_id = NULLIF(raw->>'id','')::bigint
 WHERE raw IS NOT NULL AND line_id IS NULL;

CREATE INDEX IF NOT EXISTS accurate_do_item_so_detail_idx
  ON accurate_delivery_order_item (sales_order_detail_id);
CREATE INDEX IF NOT EXISTS accurate_do_item_so_idx
  ON accurate_delivery_order_item (sales_order_id);
-- Sasaran join; unik karena id detail Accurate unik lintas dokumen.
CREATE UNIQUE INDEX IF NOT EXISTS accurate_so_item_line_id_key
  ON accurate_sales_order_item (line_id) WHERE line_id IS NOT NULL;

COMMENT ON COLUMN accurate_delivery_order_item.sales_order_detail_id IS
  'raw.salesOrderDetailId — menunjuk accurate_sales_order_item.line_id (dasar fill rate per pesanan).';
COMMENT ON COLUMN accurate_sales_order_item.line_id IS
  'raw.id — id baris detail versi Accurate, sasaran tautan dari baris delivery-order.';
