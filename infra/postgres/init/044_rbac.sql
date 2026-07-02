-- 044 — RBAC per-fitur + per-grup (gaya Accurate "Akses Grup"). Additive, idempoten.
--
-- Model: app_user (identitas, tetap) ─< app_user_group >─ access_group ─< access_permission >─ feature
--   - access_group  : grup/role (Administrator/Operator/Viewer + grup custom)
--   - feature       : katalog fitur = item menu (selaras apps/web .../app-sidebar.tsx)
--   - access_permission : matriks grup × fitur × aksi (active/view/create/edit/delete) ← Aktif/Buat/Ubah/Hapus/Lihat
--   - app_user_group: keanggotaan M:N (izin efektif = gabungan OR semua grup)
-- app_user.role (lama) DIPERTAHANKAN (expand-contract) — di-backfill ke membership.

CREATE TABLE IF NOT EXISTS access_group (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,   -- grup bawaan (tak boleh dihapus)
  superuser   boolean NOT NULL DEFAULT false,   -- bypass semua cek (Administrator)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature (
  key     text PRIMARY KEY,                      -- slug route (mis. 'watchpoint','monitor-rekap')
  name    text NOT NULL,
  section text NOT NULL,                          -- grup menu (Overview/HR/Sales/…/Admin)
  path    text NOT NULL,
  sort    int  NOT NULL DEFAULT 0,
  active  boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS access_permission (
  group_id    bigint  NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  feature_key text    NOT NULL REFERENCES feature(key)     ON DELETE CASCADE,
  active      boolean NOT NULL DEFAULT false,    -- fitur diaktifkan utk grup (kolom "Aktif")
  can_view    boolean NOT NULL DEFAULT false,
  can_create  boolean NOT NULL DEFAULT false,
  can_edit    boolean NOT NULL DEFAULT false,
  can_delete  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, feature_key)
);

CREATE TABLE IF NOT EXISTS app_user_group (
  user_id  uuid   NOT NULL REFERENCES app_user(id)    ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES access_group(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS app_user_group_group_idx ON app_user_group (group_id);

-- ── Seed grup sistem ──────────────────────────────────────────────
INSERT INTO access_group (key, name, description, is_system, superuser) VALUES
  ('administrator', 'Administrator', 'Akses penuh seluruh fitur', true, true),
  ('operator',      'Operator',      'Akses operasional (kecuali menu Admin)', true, false),
  ('viewer',        'Viewer',        'Hanya lihat', true, false)
ON CONFLICT (key) DO NOTHING;

-- ── Seed fitur (selaras app-sidebar.tsx; key = slug route) ────────
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('overview',          'Sales Overview',      'Overview',   '/overview',          10),
  ('watchpoint',        'WatchPoint HoD',      'Overview',   '/watchpoint',        20),
  ('dashboard',         'Plan & Report',       'HR',         '/dashboard',         30),
  ('todos',             'Sales TODO',          'HR',         '/todos',             40),
  ('visits',            'Visits',              'HR',         '/visits',            50),
  ('reminders',         'Reminders',           'HR',         '/reminders',         60),
  ('holidays',          'Holidays',            'HR',         '/holidays',          70),
  ('leave',             'Manage Leave',        'HR',         '/leave',             80),
  ('calendar',          'Sales Calendar',      'Sales',      '/calendar',          90),
  ('sales',             'Sales Performance',   'Sales',      '/sales',            100),
  ('competitor',        'Competitor Intel',    'Sales',      '/competitor',       110),
  ('pipeline',          'Pipeline',            'Sales',      '/pipeline',         120),
  ('customers',         'Customers',           'Sales',      '/customers',        130),
  ('ar',                'AR Aging',            'Sales',      '/ar',               140),
  ('sales-docs',        'Sales Docs',          'Sales',      '/sales-docs',       150),
  ('collection-drafts', 'Collection Drafts',   'Sales',      '/collection-drafts',160),
  ('people',            'People Analytics',    'Analytics',  '/people',           170),
  ('network',           'Spider Network',      'Analytics',  '/network',          180),
  ('briefings',         'Executive Briefings', 'Analytics',  '/briefings',        190),
  ('coaching',          'Coaching Notes',      'Analytics',  '/coaching',         200),
  ('reports',           'Reports',             'Analytics',  '/reports',          210),
  ('digests',           'Digest History',      'Analytics',  '/digests',          220),
  ('monitor-rekap',     'Rekap',               'Monitor',    '/monitor/rekap',    230),
  ('monitor-resume',    'Resume',              'Monitor',    '/monitor/resume',   240),
  ('monitor-pola',      'Pola Komunikasi',     'Monitor',    '/monitor/pola',     250),
  ('monitor-members',   'Members',             'Monitor',    '/monitor/members',  260),
  ('products',          'Products',            'Operations', '/products',         270),
  ('inventory',         'Inventory',           'Operations', '/inventory',        280),
  ('orders',            'Orders',              'Operations', '/orders',           290),
  ('shipments',         'Shipments',           'Operations', '/shipments',        300),
  ('suppliers',         'Suppliers',           'Operations', '/suppliers',        310),
  ('hitl',              'HITL Review',         'Operations', '/hitl',             320),
  ('users',             'Users',               'Admin',      '/users',            330),
  ('user-access',       'User Access',         'Admin',      '/user-access',      340),
  ('access-groups',     'Akses Grup',          'Admin',      '/access-groups',    350),
  ('settings',          'Settings',            'Admin',      '/settings',         360),
  ('showcase',          'UI Showcase',         'Admin',      '/showcase',         370)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

-- ── Seed matriks izin per grup (cross-join feature → tetap sinkron) ─
-- Administrator: full grid (anti-lockout).
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, true
FROM access_group g CROSS JOIN feature f
WHERE g.key = 'administrator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- Operator: semua kecuali seksi Admin → view+create+edit (tanpa delete).
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, false
FROM access_group g CROSS JOIN feature f
WHERE g.key = 'operator' AND f.section <> 'Admin'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- Viewer: semua fitur → view only.
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, false, false, false
FROM access_group g CROSS JOIN feature f
WHERE g.key = 'viewer'
ON CONFLICT (group_id, feature_key) DO NOTHING;

-- ── Backfill keanggotaan dari app_user.role lama ──────────────────
INSERT INTO app_user_group (user_id, group_id)
SELECT u.id, g.id
FROM app_user u
JOIN access_group g ON g.key = CASE lower(u.role)
  WHEN 'admin'  THEN 'administrator'
  WHEN 'viewer' THEN 'viewer'
  ELSE 'operator'
END
ON CONFLICT DO NOTHING;
