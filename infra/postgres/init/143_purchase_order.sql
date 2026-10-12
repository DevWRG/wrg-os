-- 078 — F13 PO Tracker + Sistem Barang Masuk (Purchasing).
--
-- Header (purchase_order) = satu PO ke vendor. Item (purchase_order_item) =
-- baris barang yang dipesan, FK CASCADE (child struktural PO, sama pola
-- dana_ops/dana_ops_item) — qty_ordered didefinisikan di sini.
-- Barang Masuk (purchase_order_receipt) = log tiap kejadian penerimaan
-- barang per item, FK item_id TANPA ON DELETE (default RESTRICT, pola sama
-- atk_stock_movement) — item yang sudah punya riwayat penerimaan tidak boleh
-- hilang keterkaitannya (audit trail); PO/item yang sudah menerima barang
-- tidak bisa dihapus (harus dibatalkan lewat cancelled_at, bukan delete).
--
-- qty_received per item & status PO (ordered/partial_received/received)
-- DIHITUNG di query (SUM purchase_order_receipt per item vs qty_ordered),
-- bukan kolom tersimpan — pola computed sama "telat" F39/"stok" F49/
-- "variance" F51. cancelled_at = override manual yang menang atas status
-- computed (pola sama terminated_at di vendor_contract F140), bukan bagian
-- dari perhitungan qty.
--
-- vendor_id opsional → accurate_vendor (ON DELETE SET NULL, pola sama F39) —
-- vendor_name tetap wajib free text krn belum semua vendor ter-Accurate.
-- pic/requested_by free text (BUKAN FK master_user/app_user — domain HR
-- off-limits, ONBOARDING.md §2).

CREATE TABLE IF NOT EXISTS purchase_order (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number    text NOT NULL,
  vendor_id    bigint REFERENCES accurate_vendor(id) ON DELETE SET NULL,
  vendor_name  text NOT NULL,
  order_date   date NOT NULL DEFAULT CURRENT_DATE,
  eta_date     date,
  cabang       text,
  pic          text,
  notes        text,
  cancelled_at timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  item_desc        text NOT NULL,
  qty_ordered      numeric NOT NULL CHECK (qty_ordered > 0),
  unit             text,
  unit_price       numeric CHECK (unit_price >= 0),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_receipt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_item_id      uuid NOT NULL REFERENCES purchase_order_item(id),
  qty_received    numeric NOT NULL CHECK (qty_received > 0),
  received_date   date NOT NULL DEFAULT CURRENT_DATE,
  received_by     text,
  condition_notes text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_order_vendor_id_idx ON purchase_order (vendor_id);
CREATE INDEX IF NOT EXISTS purchase_order_eta_date_idx ON purchase_order (eta_date);
CREATE INDEX IF NOT EXISTS purchase_order_item_purchase_order_id_idx ON purchase_order_item (purchase_order_id);
CREATE INDEX IF NOT EXISTS purchase_order_receipt_po_item_id_idx ON purchase_order_receipt (po_item_id);

COMMENT ON TABLE purchase_order IS
  'F13 PO Tracker — header pesanan pembelian ke vendor (Purchasing).';
COMMENT ON TABLE purchase_order_item IS
  'F13 — baris barang yang dipesan milik satu purchase_order.';
COMMENT ON TABLE purchase_order_receipt IS
  'F13 Sistem Barang Masuk — log penerimaan barang per purchase_order_item, po_item_id RESTRICT jaga audit trail.';
