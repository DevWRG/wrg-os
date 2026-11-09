-- 240 — F152 3-Way Match Faktur Pembelian (AP): Faktur vs PO vs Penerimaan.
--
-- Keputusan Direktur (Okt 2026): faktur vendor diambil dari Accurate; toleransi selisih 0%
-- (qty & harga persis, admin mencocokkan dengan surat jalan); jadwal bayar manual (tidak di sini).
--
-- Probe read-only 19 Okt 2026 (150 faktur, 312 baris): detailItem[] faktur membawa id sampai
-- tingkat BARIS — purchaseOrderDetailId (= purchase_order_item.accurate_detail_id, 205) dan
-- receiveItemDetailId (= inbound_receiving_line.accurate_detail_id, 206). Maka cermin faktur
-- cukup menyimpan dua id itu; hasil match DIHITUNG saat dibaca (tak ada tabel hasil → tak basi).
-- Nomor SJ vendor TIDAK ada di faktur; diambil dari penerimaan (supplier_doc_number).

CREATE TABLE IF NOT EXISTS accurate_purchase_invoice (
  accurate_id          bigint PRIMARY KEY,
  -- number Accurate apa adanya; draft berawalan "DFT.n [...]".
  number               text NOT NULL,
  -- nomor faktur vendor (field billNumber), bukan number.
  bill_number          text,
  vendor_id            bigint,
  vendor_name          text NOT NULL,
  trans_date           date NOT NULL,
  due_date             date,
  status_name          text,
  approval_status      text,
  total_amount         numeric,
  description          text,
  -- lastUpdate & optLock Accurate: detail ditarik ulang bila salah satunya berubah.
  accurate_last_update timestamptz,
  opt_lock             integer,
  items_last_update    timestamptz,
  items_opt_lock       integer,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accurate_purchase_invoice_trans_date_idx ON accurate_purchase_invoice (trans_date DESC);
CREATE INDEX IF NOT EXISTS accurate_purchase_invoice_vendor_idx ON accurate_purchase_invoice (vendor_id);

CREATE TABLE IF NOT EXISTS accurate_purchase_invoice_line (
  accurate_detail_id         bigint PRIMARY KEY,
  invoice_id                 bigint NOT NULL REFERENCES accurate_purchase_invoice(accurate_id) ON DELETE CASCADE,
  item_no                    text,
  item_desc                  text NOT NULL,
  qty                        numeric NOT NULL,
  -- returnQuantity per baris; qty netto = qty - return_qty.
  return_qty                 numeric NOT NULL DEFAULT 0,
  unit_name                  text,
  unit_ratio                 numeric,
  -- harga satuan SEBELUM diskon & PPN (field unitPrice).
  unit_price                 numeric,
  -- itemDiscPercent apa adanya ('' / '35' / '10+5'); disc_amount = itemCashDiscount.
  disc_raw                   text,
  disc_amount                numeric NOT NULL DEFAULT 0,
  total_price                numeric,
  accurate_po_id             bigint,
  accurate_po_detail_id      bigint,
  po_number                  text,
  accurate_receive_id        bigint,
  accurate_receive_detail_id bigint,
  receive_number             text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accurate_purchase_invoice_line_invoice_idx ON accurate_purchase_invoice_line (invoice_id);
CREATE INDEX IF NOT EXISTS accurate_purchase_invoice_line_po_detail_idx ON accurate_purchase_invoice_line (accurate_po_detail_id);
CREATE INDEX IF NOT EXISTS accurate_purchase_invoice_line_receive_detail_idx ON accurate_purchase_invoice_line (accurate_receive_detail_id);

-- Diskon baris PO (itemDiscPercent) belum dicermin; faktur berdiskon (35%/25% di sampel) tak bisa
-- dibandingkan tanpa ini. NULL = belum tersinkron (bukan "tanpa diskon"); baris PO Accurate
-- ditarik ulang di bawah supaya terisi.
ALTER TABLE purchase_order_item
  ADD COLUMN IF NOT EXISTS disc_raw text;

UPDATE purchase_order SET items_last_update = NULL WHERE source = 'accurate' AND items_last_update IS NOT NULL;

COMMENT ON TABLE accurate_purchase_invoice IS
  'F152 (240) — cermin read-only purchase-invoice Accurate; hasil 3-way match dihitung saat dibaca.';
COMMENT ON COLUMN accurate_purchase_invoice_line.accurate_po_detail_id IS
  'F152 (240) — purchaseOrderDetailId = purchase_order_item.accurate_detail_id (205).';
COMMENT ON COLUMN accurate_purchase_invoice_line.accurate_receive_detail_id IS
  'F152 (240) — receiveItemDetailId = inbound_receiving_line.accurate_detail_id (206).';
COMMENT ON COLUMN purchase_order_item.disc_raw IS
  'F152 (240) — itemDiscPercent Accurate apa adanya (''''/''35''/''10+5''); NULL = belum tersinkron.';

-- Default privileges (039) sudah menutup tabel baru, tapi eksplisit di sini
-- supaya tak bergantung pada siapa yang menjalankan migrasi (pola 201/203/206).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON accurate_purchase_invoice, accurate_purchase_invoice_line TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON accurate_purchase_invoice, accurate_purchase_invoice_line TO wrg_readonly;
  END IF;
END $$;
