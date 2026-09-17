-- 068 — F51 Dana Ops / Petty Cash Realization (General Affairs).
--
-- Header (dana_ops) = satu pengajuan dana operasional (uang muka/petty cash)
-- per kejadian. Item realisasi (dana_ops_item) = baris bukti pengeluaran
-- (nota/kwitansi) yang direkonsiliasi terhadap dana yang diajukan — pola
-- header+item yang sama dengan F36 (inbound_receiving/inbound_receiving_item).
--
-- `requested_by` sengaja free text (BUKAN FK ke master_user/app_user — domain
-- HR off-limits untuk magang, lihat ONBOARDING.md §2). Realisasi total &
-- selisih terhadap dana yang diajukan dihitung di query (SUM item), bukan
-- kolom tersimpan — sama seperti "telat" di F39 / "siap ditutup" di F36.

CREATE TABLE IF NOT EXISTS dana_ops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabang           text,
  requested_by     text NOT NULL,
  purpose          text NOT NULL,
  amount_requested numeric NOT NULL CHECK (amount_requested >= 0),
  request_date     date NOT NULL DEFAULT CURRENT_DATE,
  status           text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','realized')),
  notes            text,
  realized_at      timestamptz,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dana_ops_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dana_ops_id  uuid NOT NULL REFERENCES dana_ops(id) ON DELETE CASCADE,
  description  text NOT NULL,
  amount       numeric NOT NULL CHECK (amount >= 0),
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dana_ops_status_idx ON dana_ops (status);
CREATE INDEX IF NOT EXISTS dana_ops_item_dana_ops_id_idx ON dana_ops_item (dana_ops_id);

COMMENT ON TABLE dana_ops IS
  'F51 Dana Ops / Petty Cash Realization — header pengajuan dana operasional (General Affairs).';
COMMENT ON TABLE dana_ops_item IS
  'F51 — baris realisasi (bukti pengeluaran) milik satu dana_ops.';
