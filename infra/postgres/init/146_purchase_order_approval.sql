-- 079 — F35 PO Approval Workflow (#APPROVE), lanjutan F13 PO Tracker (078).
--
-- Rantai approval berjenjang sebelum barang masuk boleh dicatat:
--   Tier 1 (paralel, dua-duanya wajib): HOD Business (IVD/Medical sesuai
--   lini PO) + HOD Finance.  Tier 2: Direktur (final). Reject di mana pun =
--   PO rejected permanen. Approval_status DIHITUNG di query/JS dari baris
--   purchase_order_approval (pola sama status PO di 078), bukan kolom
--   tersimpan.
--
-- lini ('IVD'/'Medical') = lini bisnis PO, field baru dipilih manual staff
-- saat create PO (item PO teks bebas, tak terhubung katalog produk — tak
-- bisa di-derive otomatis). Vocab disamakan dgn deal.product_category /
-- product_pricelist.lini — BEDA dari klasifikasi.ts yang pakai IVD/Alkes/
-- NON IVD, jangan disamakan. NULL = PO dibuat sebelum F35 ("legacy_exempt"),
-- tidak kena gate approval sama sekali (grandfather, bukan backfill paksa).
--
-- required_hod_key di-snapshot saat PO dibuat (mufid=IVD/arman=Medical utk
-- baris hod_business, ika utk hod_finance, NULL utk direktur) — BUKAN
-- di-resolve ulang live dari lini saat approve, supaya reassignment hod_key
-- admin (PATCH /admin/users/:id) tidak mengubah retroaktif siapa yang
-- berwenang atas baris pending lama.

ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS lini text
  CHECK (lini IN ('IVD','Medical'));

CREATE TABLE IF NOT EXISTS purchase_order_approval (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  approver_role     text NOT NULL CHECK (approver_role IN ('hod_business','hod_finance','direktur')),
  required_hod_key  text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by        text,
  decided_at        timestamptz,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id, approver_role)
);

CREATE INDEX IF NOT EXISTS purchase_order_approval_po_id_idx ON purchase_order_approval (purchase_order_id);

COMMENT ON TABLE purchase_order_approval IS
  'F35 PO Approval Workflow — baris per approver (hod_business/hod_finance/direktur), FK CASCADE ke purchase_order.';
COMMENT ON COLUMN purchase_order.lini IS
  'F35 — lini bisnis PO (IVD/Medical), NULL = PO pra-F35 (legacy_exempt dari gate approval).';
