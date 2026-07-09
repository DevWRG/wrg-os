-- 051 — F127: registrasi menu "Sales Alerts" (/sales-alerts) di RBAC (feature +
-- izin grup sistem). Setara efek tombol "Sync Fitur" tapi deterministik saat
-- deploy. Additive, idempoten. Pola sama 049 (sales-analytics).

INSERT INTO feature (key, name, section, path, sort) VALUES
  ('sales-alerts', 'Sales Alerts', 'Sales', '/sales-alerts', 106)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

-- Administrator: full. Operator: view+create+edit. Viewer: view only.
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-alerts', true, true, true, true, true
FROM access_group g WHERE g.key = 'administrator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-alerts', true, true, true, true, false
FROM access_group g WHERE g.key = 'operator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'sales-alerts', true, true, false, false, false
FROM access_group g WHERE g.key = 'viewer'
ON CONFLICT (group_id, feature_key) DO NOTHING;
