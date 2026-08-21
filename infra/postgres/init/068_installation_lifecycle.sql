-- 068 — Instalasi Alat Lifecycle (F22, AFTERSALES): checklist 5 langkah SEKUENSIAL
-- per alat (unit medis) yang diinstal di lokasi customer:
--   1. po_control      — nomor PO divalidasi
--   2. sj              — Surat Jalan (delivery note) terbit
--   3. teknisi_assign  — teknisi lapangan ditugaskan
--   4. training        — training customer selesai
--   5. bast            — Berita Acara Serah Terima ditandatangani (lifecycle SELESAI)
--
-- SENGAJA self-contained / tanpa FK ke domain lain (CRM/HR) — teknisi_name,
-- customer_name, po_number, sj_number, bast_number semua TEXT bebas, BUKAN
-- referensi ke master_user / accurate_delivery_order / deal|account|customer.
-- (lihat ONBOARDING.md §2 — domain terlarang Management/Infra/CRM/HR).
--
-- `status` = langkah TERJAUH yang sudah selesai (buat filter list); validasi
-- URUTAN transisi tetap dari kolom *_done (lihat apps/api/src/repo/installation.ts),
-- bukan dari `status` semata.

CREATE TABLE IF NOT EXISTS installation_unit (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  alat_name            text NOT NULL,
  serial_number        text,
  customer_name        text NOT NULL,
  cabang               text,

  po_number            text,
  po_control_done      boolean NOT NULL DEFAULT false,
  po_control_at        timestamptz,

  sj_number            text,
  sj_done              boolean NOT NULL DEFAULT false,
  sj_at                timestamptz,

  teknisi_name         text,
  teknisi_assign_done  boolean NOT NULL DEFAULT false,
  teknisi_assign_at    timestamptz,

  training_notes       text,
  training_done        boolean NOT NULL DEFAULT false,
  training_at          timestamptz,

  bast_number          text,
  bast_done            boolean NOT NULL DEFAULT false,
  bast_at              timestamptz,

  status               text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','po_control','sj','teknisi_assign','training','bast')),

  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS installation_unit_status_idx     ON installation_unit (status);
CREATE INDEX IF NOT EXISTS installation_unit_created_at_idx ON installation_unit (created_at DESC);

COMMENT ON TABLE installation_unit IS
  'F22 — Instalasi Alat Lifecycle (AFTERSALES): checklist 5 langkah sekuensial PO control→SJ→teknisi→training→BAST, self-contained (tanpa FK ke domain lain).';
