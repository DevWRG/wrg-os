-- 289: F10 Finance Ops Resilience bagian 1 — alarm fakturis diam (docs/features/F10-finance-ops-resilience.md).
--
-- Prod 7 Nov 2026: 60 hari terakhir semua faktur dibuat oleh 2 akun Accurate (raw->>'createdBy'). Kalau keduanya
-- berhalangan penerbitan faktur berhenti tanpa ada yang tahu. Dicek sesudah tiap sync faktur: hari kerja,
-- jam kerja, ≥ N jam tanpa faktur baru → satu alarm ke grup Finance; faktur berikutnya → pesan pulih.
-- Additive + idempoten.

-- Satu baris per kejadian diam. pulih_at NULL = masih diam (paling banyak satu baris terbuka).
CREATE TABLE IF NOT EXISTS fakturis_diam (
  id                BIGSERIAL PRIMARY KEY,
  sejak_at          TIMESTAMPTZ NOT NULL,          -- createDate faktur terakhir / 08:00 hari itu
  alarm_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  alarm_terkirim    BOOLEAN NOT NULL DEFAULT false,
  faktur_terakhir   TEXT,                          -- nomor faktur terakhir sebelum diam
  pulih_at          TIMESTAMPTZ,                   -- createDate faktur pertama sesudah diam
  pulih_faktur      TEXT,
  pulih_terkirim    BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS fakturis_diam_satu_terbuka ON fakturis_diam ((true)) WHERE pulih_at IS NULL;

-- Pemetaan akun pembuat faktur Accurate (raw->>'createdBy') → orang. Diisi lewat UI, bukan di kode.
CREATE TABLE IF NOT EXISTS fakturis_akun (
  created_by     TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  diubah_oleh    TEXT,
  diubah_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON fakturis_diam TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE fakturis_diam_id_seq TO wrg_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON fakturis_akun TO wrg_app;
  END IF;
END $$;
