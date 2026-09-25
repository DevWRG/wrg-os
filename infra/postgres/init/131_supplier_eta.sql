-- 068 — F39 Supplier ETA Tracker: catat estimasi tanggal barang datang dari
-- supplier (per PO/reference), supaya Purchasing bisa pantau mana yang
-- telat (ETA lewat tapi belum datang) tanpa menunggu F13 (PO Tracker penuh).
--
-- vendor_id opsional (link ke mirror accurate_vendor bila vendor sudah ada
-- di Accurate); vendor_name tetap wajib diisi manual karena tidak semua
-- supplier tercatat/tersinkron di Accurate.
--
-- Status hanya menyimpan state alur ('pending'/'arrived'/'cancelled') —
-- "telat" dihitung di aplikasi (eta_date < hari ini AND status='pending'),
-- bukan disimpan, supaya tak perlu job cron terpisah untuk update status.

CREATE TABLE IF NOT EXISTS supplier_eta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id           bigint REFERENCES accurate_vendor(id),
  vendor_name         text NOT NULL,
  po_number           text,
  item_desc           text NOT NULL,
  qty                 numeric(14,2),
  eta_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','cancelled')),
  actual_arrival_date date,
  cabang              text,
  notes               text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_eta_status_idx ON supplier_eta (status);
CREATE INDEX IF NOT EXISTS supplier_eta_eta_date_idx ON supplier_eta (eta_date);
CREATE INDEX IF NOT EXISTS supplier_eta_vendor_id_idx ON supplier_eta (vendor_id);

COMMENT ON TABLE supplier_eta IS
  'F39 Supplier ETA Tracker — estimasi tanggal barang datang per PO/vendor (Purchasing).';
