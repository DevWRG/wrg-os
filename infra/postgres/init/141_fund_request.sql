-- 078 — F138 Operational Fund Request + Multi-Step Approval Workflow.
--
-- Modul BARU, berdiri sendiri — sengaja TIDAK terhubung ke dana_ops (F51,
-- belum merge ke dev) dengan cara apa pun. Semua Karyawan boleh mengajukan
-- (self-service), bukan HOD-only seperti dana_ops.
--
-- Approval 2 tahap FIXED (bukan paralel/threshold seperti purchase_order_approval
-- F35): HOD -> Direktur. Tier-1 HOD dipilih MANUAL oleh pengaju dari dropdown
-- HOD aktif saat submit (bukan auto-resolve dari org-chart/cabang — app_user
-- tidak punya field "atasan langsung" yang bisa dipercaya utk staff non-AM).
-- required_hod_key di-snapshot saat create (pola sama F35), BUKAN di-resolve
-- ulang live — reassignment hod_key admin tidak mengubah retroaktif siapa
-- berwenang atas baris pending lama.
--
-- fund_request_approval.status DIHITUNG di query/JS dari baris ini (pola
-- computed yang sama dgn purchase_order_approval), bukan kolom tersimpan.

CREATE TABLE IF NOT EXISTS fund_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_name    text NOT NULL,
  requester_email   text NOT NULL,
  purpose           text NOT NULL,
  amount_requested  numeric(14,2) NOT NULL CHECK (amount_requested > 0),
  cabang            text,
  request_date      date NOT NULL DEFAULT CURRENT_DATE,
  hod_approver_key  text NOT NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_request_approval (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_request_id  uuid NOT NULL REFERENCES fund_request(id) ON DELETE CASCADE,
  approver_role    text NOT NULL CHECK (approver_role IN ('hod','direktur')),
  required_hod_key text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by       text,
  decided_at       timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_request_id, approver_role)
);

CREATE INDEX IF NOT EXISTS fund_request_approval_fr_id_idx ON fund_request_approval (fund_request_id);
CREATE INDEX IF NOT EXISTS fund_request_requester_email_idx ON fund_request (requester_email);

COMMENT ON TABLE fund_request IS
  'F138 Operational Fund Request — pengajuan dana operasional oleh Karyawan, standalone dari dana_ops (F51).';
COMMENT ON TABLE fund_request_approval IS
  'F138 — baris per approver (hod/direktur), FK CASCADE ke fund_request. required_hod_key di-snapshot saat create.';
