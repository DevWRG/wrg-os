-- 258_doc_tracker.sql — DOC: Document Tracker 9-state machine (Draft → Review → Approved → Sent →
-- Received → Executed → Billed → Paid → Closed). State TIDAK disimpan: dihitung dari mirror Accurate
-- (SO/DO/faktur) + shipment_tracking (kirim/terima/BAST). Tabel di bawah hanya untuk hal yang TIDAK
-- ada di Accurate: stempel Review/Approved, checklist tanda tangan dokumen, dan tautan faktur manual.
-- Unit = satu Sales Order Accurate (so_id = accurate_sales_order.id). Additive & idempoten.
-- Nomor 257 dipakai PR F150 (biaya per area) yang belum merge — cek ulang bila urutan merge berubah.

CREATE TABLE IF NOT EXISTS doc_tracker_stamp (
  so_id      bigint      NOT NULL,
  tahap      text        NOT NULL CHECK (tahap IN ('review', 'approved')),
  at         timestamptz NOT NULL DEFAULT now(),
  by         text        NOT NULL,
  catatan    text,
  PRIMARY KEY (so_id, tahap)
);

CREATE TABLE IF NOT EXISTS doc_tracker_dokumen (
  so_id      bigint      NOT NULL,
  jenis      text        NOT NULL CHECK (jenis IN ('po_customer', 'sj_ttd_gudang', 'sj_ttd_sales', 'sj_ttd_kepala_sales', 'sj_ttd_teknisi')),
  ada        boolean     NOT NULL DEFAULT true,
  at         timestamptz NOT NULL DEFAULT now(),
  by         text        NOT NULL,
  catatan    text,
  PRIMARY KEY (so_id, jenis)
);

-- Tautan faktur ↔ SO yang dipilih MANUAL. Dipakai bila faktur di mirror tak membawa referensi SO/SJ;
-- tautan tak pernah ditebak dari nama customer/tanggal.
CREATE TABLE IF NOT EXISTS doc_tracker_faktur (
  so_id       bigint      NOT NULL,
  invoice_id  bigint      NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  by          text        NOT NULL,
  PRIMARY KEY (so_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS doc_tracker_faktur_invoice_idx ON doc_tracker_faktur (invoice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON doc_tracker_stamp, doc_tracker_dokumen, doc_tracker_faktur TO wrg_app;
GRANT SELECT ON doc_tracker_stamp, doc_tracker_dokumen, doc_tracker_faktur TO wrg_readonly;
