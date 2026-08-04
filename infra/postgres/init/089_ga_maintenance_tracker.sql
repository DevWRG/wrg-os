-- 089 — F137 GA Maintenance & Recurrence Tracker. Depends F132 (ga_assets,
-- migrasi 086).
--
-- Upgrade SENGAJA dari gais/006_maintenance.sql + 009 (recurrence), BUKAN
-- replikasi 1:1 — source TIDAK punya asset_id FK (cuma asset_name free-text)
-- & vendor cuma VARCHAR bebas. F132 sekarang kasih registry aset nyata yang
-- source-nya dulu tidak punya, jadi asset_id/vendor_id FK sungguhan di sini.
--
-- Status (requested/in_progress/completed/cancelled) PERSIS diadopsi dari
-- source. "overdue" DIHITUNG saat baca (due_date < today AND status NOT IN
-- ('completed','cancelled')) — TIDAK disimpan sbg status tersendiri
-- (pelajaran F38: tier dihitung on-read, bukan due_date statis).
--
-- Approval Finance (TAMBAHAN, tak ada di source): status 'pending_finance'
-- + approved_by/approved_at — transisi ke 'completed' ditolak (app-layer,
-- repo/ga-maintenance.ts) kalau cost_actual > Rp5jt DAN approved_by NULL.

CREATE TABLE IF NOT EXISTS ga_vendor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama           text NOT NULL,
  category       text,                 -- TEXT bebas (mis. "AC","Genset","IT") — bukan enum tertutup, sama source
  contact_person text,
  phone          text,
  contract_end   date,
  notes          text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_vendor_status_idx ON ga_vendor (status);

CREATE TABLE IF NOT EXISTS ga_maintenance_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid NOT NULL REFERENCES ga_assets(id) ON DELETE CASCADE,

  maint_type      text NOT NULL DEFAULT 'preventive' CHECK (maint_type IN ('preventive','corrective')),
  due_date        date,

  -- Alur: requested -> in_progress -> completed. pending_finance = tambahan
  -- (gate cost>Rp5jt, lihat header). cancelled bisa dari requested/in_progress.
  status          text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','in_progress','pending_finance','completed','cancelled')),

  cost_budget     numeric(15,2) NOT NULL DEFAULT 0,
  cost_actual     numeric(15,2) NOT NULL DEFAULT 0,
  vendor_id       uuid REFERENCES ga_vendor(id) ON DELETE SET NULL,

  recur_months    int NOT NULL DEFAULT 0 CHECK (recur_months >= 0 AND recur_months <= 60),
  recur_parent_id uuid REFERENCES ga_maintenance_schedules(id) ON DELETE SET NULL,

  approved_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at     timestamptz,

  notes           text,
  started_at      timestamptz,
  completed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_maint_asset_idx        ON ga_maintenance_schedules (asset_id);
CREATE INDEX IF NOT EXISTS ga_maint_due_idx           ON ga_maintenance_schedules (due_date);
CREATE INDEX IF NOT EXISTS ga_maint_status_idx        ON ga_maintenance_schedules (status);
CREATE INDEX IF NOT EXISTS ga_maint_recur_parent_idx  ON ga_maintenance_schedules (recur_parent_id);

COMMENT ON TABLE ga_vendor IS
  'F137 — master vendor GA (servis AC/genset/dst), TERPISAH dari accurate_vendor (mirror Accurate, vendor barang/purchasing).';
COMMENT ON TABLE ga_maintenance_schedules IS
  'F137 — jadwal maintenance aset (preventive/corrective) + recurrence. asset_id/vendor_id FK sungguhan (upgrade dari source gais yg free-text). Approval Finance utk cost>Rp5jt via approved_by, dicek app-layer bukan constraint DB.';

-- Feature key utk gate "Approve Finance" (apps/web/src/lib/ga-maintenance-access.ts)
-- lewat matriks Akses Grup — didaftarkan manual di sini krn BUKAN nav item
-- (aksi inline di tabel Maintenance, bukan halaman sendiri), jadi tak ikut
-- featureCatalog()/"Sync Fitur" otomatis. Tanpa baris ini admin tak punya
-- cara centang izinnya di UI Akses Grup (gate tetap jalan via fallback title
-- "finance", cuma matriksnya idle sampai baris ini ada).
INSERT INTO feature (key, name, section, path, sort, active)
VALUES ('ga-finance-approval', 'Approval Finance — Maintenance GA', 'GA', '/ga-aset', 999, true)
ON CONFLICT (key) DO NOTHING;
