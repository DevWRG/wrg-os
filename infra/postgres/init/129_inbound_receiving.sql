-- 068 — F36 Inbound Receiving Checklist: checklist verifikasi saat barang
-- datang dari supplier (Purchasing), independen dari F13 (PO Tracker penuh)
-- yang belum ada — pendekatan sama seperti F39 (lihat 131_supplier_eta.sql di
-- branch F39, belum merge ke dev saat file ini dibuat).
--
-- Header (inbound_receiving) = satu kejadian penerimaan barang (per PO/SJ).
-- Item checklist (inbound_receiving_item) = baris poin verifikasi (jumlah
-- sesuai, kondisi fisik, dokumen lengkap, dst) yang dicentang satu per satu.
-- Default checklist di-seed dari aplikasi saat header dibuat (lihat
-- apps/api/src/repo/inbound-receiving.ts) — item tambahan boleh ditambah
-- manual per kejadian (mis. kasus khusus per supplier).

CREATE TABLE IF NOT EXISTS inbound_receiving (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     bigint REFERENCES accurate_vendor(id),
  vendor_name   text NOT NULL,
  po_number     text,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  cabang        text,
  received_by   text,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  overall_notes text,
  completed_at  timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inbound_receiving_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id uuid NOT NULL REFERENCES inbound_receiving(id) ON DELETE CASCADE,
  label        text NOT NULL,
  is_checked   boolean NOT NULL DEFAULT false,
  notes        text,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_receiving_status_idx ON inbound_receiving (status);
CREATE INDEX IF NOT EXISTS inbound_receiving_vendor_id_idx ON inbound_receiving (vendor_id);
CREATE INDEX IF NOT EXISTS inbound_receiving_item_receiving_id_idx ON inbound_receiving_item (receiving_id);

COMMENT ON TABLE inbound_receiving IS
  'F36 Inbound Receiving Checklist — header penerimaan barang per PO/vendor (Purchasing).';
COMMENT ON TABLE inbound_receiving_item IS
  'F36 — baris item checklist (poin verifikasi) milik satu inbound_receiving.';
