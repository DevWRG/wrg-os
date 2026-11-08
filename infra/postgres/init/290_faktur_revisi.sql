-- 290: F10 Finance Ops Resilience bagian 2 — faktur revisi + SLA (docs/features/F10-finance-ops-resilience.md).
--
-- Revisi faktur di Accurate = dihapus lalu diinput ulang dengan nomor sama (id baru), atau diedit di tempat
-- (raw->>'optLock' naik). Prod 7 Nov: 20 input ulang dalam 2,5 minggu (accurate_invoice_hilang.ada_kembaran),
-- tapi jam PERMINTAAN revisi tak tercatat di mana pun → SLA tak bisa diukur.
--   • sumber 'wa'      : #REVISI <nomor> | alasan → diminta_at + batas_sla; ditutup otomatis oleh sync.
--   • sumber 'deteksi' : input ulang tanpa #REVISI (dari accurate_invoice_hilang) → dicatat tanpa SLA.
-- Additive + idempoten.

CREATE TABLE IF NOT EXISTS faktur_revisi (
  id                 BIGSERIAL PRIMARY KEY,
  nomor              TEXT NOT NULL,
  sumber             TEXT NOT NULL CHECK (sumber IN ('wa', 'deteksi')),
  invoice_id_awal    BIGINT,                 -- id Accurate saat diminta (wa) / id yang dihapus (deteksi)
  opt_lock_awal      INTEGER,
  customer           TEXT,
  alasan             TEXT,
  diminta_oleh       TEXT,
  diminta_at         TIMESTAMPTZ,            -- NULL untuk deteksi (jam permintaan tak diketahui)
  batas_sla          TIMESTAMPTZ,
  invoice_id_baru    BIGINT,
  selesai_at         TIMESTAMPTZ,
  cara_selesai       TEXT CHECK (cara_selesai IN ('input_ulang', 'edit', 'manual')),
  ditutup_oleh       TEXT,
  catatan            TEXT,
  terlambat_dikirim  BOOLEAN NOT NULL DEFAULT false,
  dibuat_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu tiket terbuka per nomor faktur.
CREATE UNIQUE INDEX IF NOT EXISTS faktur_revisi_satu_terbuka ON faktur_revisi (upper(nomor)) WHERE selesai_at IS NULL;
-- Deteksi tak mencatat penghapusan yang sama dua kali.
CREATE UNIQUE INDEX IF NOT EXISTS faktur_revisi_deteksi_unik ON faktur_revisi (invoice_id_awal) WHERE sumber = 'deteksi';
CREATE INDEX IF NOT EXISTS faktur_revisi_dibuat_idx ON faktur_revisi (dibuat_at DESC);
-- Pencarian faktur per nomor (tutup otomatis tiap sync).
CREATE INDEX IF NOT EXISTS accurate_invoice_number_upper_idx ON accurate_invoice (upper(number));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON faktur_revisi TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE faktur_revisi_id_seq TO wrg_app;
  END IF;
END $$;
