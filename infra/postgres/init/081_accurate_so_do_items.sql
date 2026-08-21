-- 081 — Baris item sales-order & delivery-order Accurate.
--
-- Sebelumnya baris item HANYA diambil on-demand saat user membuka dialog
-- Orders/Shipments (getSalesOrderItems/getDeliveryOrderItems) dan tidak pernah
-- disimpan. Akibatnya tak ada satu pun metric yang bisa dihitung dari qty —
-- termasuk "Fill rate" (Ika) yang karena itu terpaksa manual.
--
-- Field yang disimpan sengaja HANYA yang jalur bacanya sudah terbukti di kode
-- produksi (detailItem[].item.no / .quantity / .itemUnit.name); sisanya masuk
-- `raw` supaya bisa dipakai nanti tanpa migrasi lagi.
--
-- items_synced_at = penanda dokumen yang barisnya sudah ditarik. Sync item
-- berjalan inkremental (1 panggilan detail.do per dokumen), jadi tanpa penanda
-- ini tiap siklus akan menarik ulang ribuan dokumen yang sama.

CREATE TABLE IF NOT EXISTS accurate_sales_order_item (
  order_id  bigint  NOT NULL REFERENCES accurate_sales_order (id) ON DELETE CASCADE,
  line_no   int     NOT NULL,
  item_no    text,
  item_name  text,
  qty        numeric,
  unit       text,
  raw        jsonb,
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX IF NOT EXISTS accurate_so_item_no_idx ON accurate_sales_order_item (item_no);

CREATE TABLE IF NOT EXISTS accurate_delivery_order_item (
  delivery_id bigint NOT NULL REFERENCES accurate_delivery_order (id) ON DELETE CASCADE,
  line_no     int    NOT NULL,
  item_no     text,
  item_name   text,
  qty         numeric,
  unit        text,
  raw         jsonb,
  PRIMARY KEY (delivery_id, line_no)
);
CREATE INDEX IF NOT EXISTS accurate_do_item_no_idx ON accurate_delivery_order_item (item_no);

ALTER TABLE accurate_sales_order    ADD COLUMN IF NOT EXISTS items_synced_at timestamptz;
ALTER TABLE accurate_delivery_order ADD COLUMN IF NOT EXISTS items_synced_at timestamptz;

-- Pemilihan dokumen yang barisnya belum ditarik (WHERE items_synced_at IS NULL
-- ORDER BY trans_date DESC) — indeks parsial supaya job item tak men-scan mirror.
CREATE INDEX IF NOT EXISTS accurate_so_items_pending_idx
  ON accurate_sales_order (trans_date DESC) WHERE items_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS accurate_do_items_pending_idx
  ON accurate_delivery_order (trans_date DESC) WHERE items_synced_at IS NULL;

COMMENT ON TABLE accurate_sales_order_item IS 'Baris item sales-order Accurate (dasar hitung fill rate F76).';
COMMENT ON TABLE accurate_delivery_order_item IS 'Baris item delivery-order Accurate (dasar hitung fill rate F76).';
