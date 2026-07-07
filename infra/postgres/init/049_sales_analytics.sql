-- 049 — F127 Sales Analytics: registrasi menu (RBAC per-fitur) + tabel pendukung
-- (saved views + threshold alert). Agregasi memakai tabel existing (accurate_*,
-- master_user, hod_territory) dan target existing (sales_region_target 046,
-- sales_target_cabang/_am 047) — TIDAK ada tabel target baru. Additive, idempoten.

-- ── Registrasi fitur menu (selaras 044_rbac.sql; key = slug route) ──
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('sales-analytics', 'Sales Analytics', 'Sales', '/sales-analytics', 105)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

-- Administrator: full. Operator: view+create+edit. Viewer: view only.
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-analytics', true, true, true, true, true
FROM access_group g WHERE g.key = 'administrator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-analytics', true, true, true, true, false
FROM access_group g WHERE g.key = 'operator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-analytics', true, true, false, false, false
FROM access_group g WHERE g.key = 'viewer'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- ── Saved views / bookmark filter per user ────────────────────────
CREATE TABLE IF NOT EXISTS sales_analytics_view_config (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  view_name     text NOT NULL,
  view_type     text NOT NULL CHECK (view_type IN ('executive','per_am','per_produk','per_cabang','per_customer','trending','custom')),
  filter_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default    boolean NOT NULL DEFAULT false,
  is_shared     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, view_name)
);
CREATE INDEX IF NOT EXISTS sav_view_user_idx ON sales_analytics_view_config (user_id);

-- ── Threshold alert (notif WA saat metrik lewat ambang) ───────────
CREATE TABLE IF NOT EXISTS sales_analytics_alert (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_name         text NOT NULL,
  owner_user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  metric_key         text NOT NULL CHECK (metric_key IN ('revenue','gp','unit_sold','customer_count','ar_balance','ar_gt_90','churn_count','new_customer_count','kso_count')),
  dimension_filter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold_operator text NOT NULL CHECK (threshold_operator IN ('lt','lte','gt','gte','eq','delta_pct_gt','delta_pct_lt','anomaly_std_gt')),
  threshold_value    numeric NOT NULL,
  window_days        int NOT NULL DEFAULT 7,
  wa_target_jid      text,
  active             boolean NOT NULL DEFAULT true,
  last_triggered_at  timestamptz,
  last_state         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_alert_owner_active_idx ON sales_analytics_alert (owner_user_id, active);
