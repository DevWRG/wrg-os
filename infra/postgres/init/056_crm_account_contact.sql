-- F62 Account & Contact 360 (CRM Fase 1) — Fase 1.
-- crm_account = ekstensi CRM di atas accurate_customer (master faskes tetap mirror
-- Accurate; tabel ini hanya menyimpan field CRM ekstra). crm_contact = multi-
-- stakeholder per account + role deal (dipakai gate Negotiation F1 SPT).

CREATE TABLE IF NOT EXISTS crm_account (
  account_id   BIGINT PRIMARY KEY REFERENCES accurate_customer(id) ON DELETE CASCADE,
  tipe         TEXT,          -- RS Pemerintah / RS Swasta / Klinik / Lab Mandiri / Bidan / Distributor
  kelas_rs     TEXT,          -- A / B / C / D
  wilayah      TEXT,
  cabang       TEXT,
  npwp         TEXT,
  status_bayar TEXT,          -- BPJS / Umum
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_contact (
  id           BIGSERIAL PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accurate_customer(id) ON DELETE CASCADE,
  nama         TEXT NOT NULL,
  jabatan      TEXT,
  role_deal    TEXT,          -- economic_buyer / user / technical / champion
  hp_wa        TEXT,
  email        TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  seq          INT NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_contact_account_idx ON crm_contact (account_id);

-- ── Menu RBAC (feature) ──
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('accounts', 'Accounts (CRM)', 'Sales', '/accounts', 55)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'accounts', true, true, true, true, true FROM access_group g WHERE g.key = 'administrator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'accounts', true, true, true, true, false FROM access_group g WHERE g.key = 'operator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'accounts', true, true, false, false, false FROM access_group g WHERE g.key = 'viewer' ON CONFLICT DO NOTHING;
