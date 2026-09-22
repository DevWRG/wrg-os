-- 179 — F60 Komite Audit Findings Tracker. Additive, idempoten. Tanpa
-- BEGIN/COMMIT sendiri (runner scripts/db/migrate.sh yang mengatur transaksi).
--
-- Konteks: post-fraud (board Roadmap #2, card F60, domain CROSS, owner
-- Fafa/Direktur/AGC layer/Faizal Corsec). Jawaban Direktur (2026-09-22) yang
-- membentuk skema ini:
--   1. "5 tahap approval, custom agar bisa di-enable 2/3/4/5" → chain GLOBAL
--      (1 config utk semua finding, pola sama approval_chain_config F11,
--      migrasi 153) dengan flag `enabled` per tahap, BUKAN pilihan jumlah
--      tahap per-finding.
--   2. "Akses dibikin custom role, dicentang siapa aja (antisipasi pergeseran
--      jabatan)" → REUSE access_group/app_user_group (044_rbac.sql, model
--      "Akses Grup" yang sudah ada), bukan bikin mekanisme pilih-orang baru.
--      Assignee tiap tahap diresolve LIVE dari keanggotaan grup saat itu
--      (bukan snapshot user), supaya pergeseran jabatan otomatis kepakai
--      cukup dengan ubah anggota grup di menu Akses Grup — tanpa sentuh data
--      finding.
--   3. "Control linkage mengacu F-number yang sudah ada" → TEKS BEBAS
--      (`control_linkage`). Tidak ada tabel katalog F-number di sistem ini
--      (dicek eksplisit) — bikin satu di luar scope F60, jadi tidak
--      di-FK-kan.
--   4. "Field ngikut existing pattern dulu" → mengikuti bentuk ga_tickets
--      (F139, migrasi 092): title/description/kode/status/timestamps.
--   5. "Reminder WA perlu" → kolom `reminded_at` per-step (dedup harian),
--      job cron terpisah (lihat apps/api/src/scheduler.ts).
--   6. "Data temuan baru ke depan" → tanpa backfill.
--
-- KENAPA TIDAK reuse tabel approval F11 (approval_chain_config/
-- approval_request/approval_step, migrasi 153) apa adanya: target_type di
-- sana dibatasi keras ke ('hod','direktur') dan resolusi ke INDIVIDU via
-- app_user.hod_key/role, approve/reject-nya lewat balasan WA #APPROVE/
-- #REJECT. Melonggarkan constraint itu utk F60 (target = grup, approve dari
-- dashboard) berisiko menyentuh behavior bot WA yang sudah dipakai. Skema di
-- bawah MENIRU pola strukturalnya (config + request + step snapshot) tapi
-- terisolasi penuh di tabel sendiri.

CREATE TABLE IF NOT EXISTS audit_finding_approval_chain_config (
  urutan          int PRIMARY KEY CHECK (urutan BETWEEN 1 AND 5),
  label           text NOT NULL,
  access_group_id bigint REFERENCES access_group(id) ON DELETE SET NULL,
  enabled         boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO audit_finding_approval_chain_config (urutan, label, enabled) VALUES
  (1, 'Layer 1', false),
  (2, 'Layer 2', false),
  (3, 'Layer 3', false),
  (4, 'Layer 4', false),
  (5, 'Layer 5', false)
ON CONFLICT (urutan) DO NOTHING;

COMMENT ON TABLE audit_finding_approval_chain_config IS
  'F60 — config GLOBAL urutan approval penutupan finding (1 chain utk semua finding). access_group_id NULL / enabled=false = tahap belum dipakai, state SAH bukan error. Diisi via panel config /audit-findings/config (admin/direktur).';

CREATE TABLE IF NOT EXISTS audit_finding (
  id              bigserial PRIMARY KEY,
  kode            text NOT NULL UNIQUE,   -- TEMUAN-YYYY-00001, pola generateTicketNo (ga-helpdesk.ts)
  title           text NOT NULL,
  description     text,
  source          text,                   -- audit internal/eksternal/whistleblower dst — teks bebas dulu
  unit_terdampak  text,
  control_linkage text,                   -- F-number rujukan; teks bebas, TIDAK di-FK (lihat catatan di kepala file)
  due_date        date,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'pending_closure', 'closed')),
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS audit_finding_status_idx ON audit_finding (status, due_date);

COMMENT ON TABLE audit_finding IS 'F60 — temuan Komite Audit. status pending_closure = sedang menunggu chain approval penutupan (lihat audit_finding_approval_request).';
COMMENT ON COLUMN audit_finding.control_linkage IS 'F-number kontrol/fitur wrg-os yang menutup temuan ini (mis. "F138"). Teks bebas — tidak ada tabel katalog F-number di sistem, jangan tambal FK/fuzzy-match tanpa keputusan baru.';

CREATE TABLE IF NOT EXISTS audit_finding_approval_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id     bigint NOT NULL REFERENCES audit_finding(id) ON DELETE CASCADE,
  requested_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  current_urutan int NOT NULL DEFAULT 1,
  decided_at     timestamptz
);

-- Cegah 2 request aktif nyala bersamaan utk finding yang sama — request lama
-- yang rejected/canceled tidak masuk hitungan, jadi PIC boleh ajukan ulang.
CREATE UNIQUE INDEX IF NOT EXISTS audit_finding_one_active_request
  ON audit_finding_approval_request (finding_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS audit_finding_approval_request_finding_idx ON audit_finding_approval_request (finding_id);

COMMENT ON TABLE audit_finding_approval_request IS 'F60 — 1 baris per pengajuan penutupan finding. Bisa lebih dari 1 per finding sepanjang waktu (request lama rejected, PIC ajukan ulang) — riwayat tidak ditimpa.';

CREATE TABLE IF NOT EXISTS audit_finding_approval_step (
  id              bigserial PRIMARY KEY,
  request_id      uuid NOT NULL REFERENCES audit_finding_approval_request(id) ON DELETE CASCADE,
  urutan          int NOT NULL,              -- sequential 1..N tahap AKTIF saat request dibuat (snapshot)
  label           text NOT NULL,             -- snapshot chain_config.label
  access_group_id bigint REFERENCES access_group(id),  -- snapshot; TIDAK ikut berubah kalau config diedit setelahnya
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  notified_at     timestamptz,
  decided_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  reminded_at     timestamptz,               -- dedup reminder harian (job overdue)
  UNIQUE (request_id, urutan)
);

CREATE INDEX IF NOT EXISTS audit_finding_approval_step_request_idx ON audit_finding_approval_step (request_id);
CREATE INDEX IF NOT EXISTS audit_finding_approval_step_pending_idx ON audit_finding_approval_step (status) WHERE status = 'pending';

COMMENT ON TABLE audit_finding_approval_step IS 'F60 — snapshot per-tahap 1 audit_finding_approval_request (dari chain_config saat request dibuat). Siapa boleh approve tahap ini = anggota app_user_group utk access_group_id, diresolve LIVE saat decide (bukan snapshot user).';
