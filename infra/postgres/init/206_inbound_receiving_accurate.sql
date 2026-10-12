-- 206 — F36 Inbound Receiving tersambung ke Penerimaan Barang Accurate
-- (permintaan user 12 Okt 2026, lanjutan PO Tracker = cermin Accurate, 205).
--
-- Probe read-only 12 Okt 2026: dokumen receive-item Accurate SUDAH bernomor
-- INBOUND gudang (01113-INBOUND/WRG/X/2026; draft = "DFT.n [nomor]"),
-- `receiveNumber` = nomor surat jalan vendor, dan tiap baris membawa nomor +
-- id PO, barang, qty, gudang, serta catatan berisi LOT/ED. Checklist inbound
-- yang diketik tangan mencatat ulang header itu tanpa tautan apa pun ke PO.
--
-- Model baru: SATU penerimaan Accurate = SATU checklist inbound, dibuat
-- otomatis oleh sinkron (header + baris barang read-only), checklist poin
-- verifikasi tetap diisi gudang di WRG-OS. Kolom `source` membedakan baris
-- lama yang diketik tangan ('manual') dari salinan Accurate ('accurate').

ALTER TABLE inbound_receiving
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'accurate')),
  ADD COLUMN IF NOT EXISTS accurate_id bigint,
  -- number Accurate apa adanya (nomor INBOUND; draft = "DFT.n [nomor]").
  ADD COLUMN IF NOT EXISTS accurate_number text,
  -- receiveNumber Accurate = nomor surat jalan / DO vendor.
  ADD COLUMN IF NOT EXISTS supplier_doc_number text,
  -- statusName (Diajukan / Diterima / Difaktur) + approvalStatus Accurate.
  ADD COLUMN IF NOT EXISTS accurate_status text,
  ADD COLUMN IF NOT EXISTS accurate_approval text,
  ADD COLUMN IF NOT EXISTS ship_date date,
  ADD COLUMN IF NOT EXISTS accurate_last_update timestamptz,
  ADD COLUMN IF NOT EXISTS items_last_update timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS inbound_receiving_accurate_id_key
  ON inbound_receiving (accurate_id) WHERE accurate_id IS NOT NULL;

-- Baris barang penerimaan Accurate (read-only, diganti tiap lastUpdate
-- berubah). Terpisah dari inbound_receiving_item yang = poin CHECKLIST.
CREATE TABLE IF NOT EXISTS inbound_receiving_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id       uuid NOT NULL REFERENCES inbound_receiving(id) ON DELETE CASCADE,
  accurate_detail_id bigint NOT NULL,
  item_no            text,
  item_desc          text NOT NULL,
  qty                numeric NOT NULL,
  unit               text,
  warehouse_name     text,
  po_number          text,
  -- id PO Accurate (= purchase_order.accurate_id, migrasi 205) — kunci tautan
  -- ke PO Tracker; po_number disimpan juga utk tampilan & pencarian.
  accurate_po_id     bigint,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_receiving_line_accurate_detail_id_key
  ON inbound_receiving_line (accurate_detail_id);
CREATE INDEX IF NOT EXISTS inbound_receiving_line_receiving_id_idx ON inbound_receiving_line (receiving_id);
CREATE INDEX IF NOT EXISTS inbound_receiving_line_accurate_po_id_idx ON inbound_receiving_line (accurate_po_id);

COMMENT ON TABLE inbound_receiving_line IS
  'F36 (206) — baris barang Penerimaan Barang Accurate milik satu inbound_receiving (source=accurate), read-only.';
COMMENT ON COLUMN inbound_receiving.source IS
  'F36 (206) — manual = diketik di WRG-OS (pra-206), accurate = dibuat sinkron dari receive-item Accurate.';

-- Default privileges (039) sudah menutup tabel baru, tapi eksplisit di sini
-- supaya tak bergantung pada siapa yang menjalankan migrasi (pola 201/203).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_receiving_line TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON inbound_receiving_line TO wrg_readonly;
  END IF;
END $$;
