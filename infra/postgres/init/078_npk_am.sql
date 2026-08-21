-- 078 — F66 NPK level AM/Sales. Cermin 058/059 tapi keyed `am_id` (master_user.am_id)
-- alih-alih hod_key: NPK per Account Manager, 7 aspek SK Pasal 3, per semester.
--
-- Kenapa tabel terpisah, bukan generalisasi 058: 058/059 sudah live di prod dengan
-- PK (hod_key,…) + FK cascade. Menambah kolom subject_type ke tabel yang sudah terisi
-- butuh backfill + ubah PK (destruktif). Tabel paralel = additive & idempoten; kalau
-- nanti dua jalur ini disatukan, migrasinya bisa dilakukan sekali dengan tenang.
--
-- Kejujuran data sama seperti jalur HoD: aspek tanpa sumber live → available=false
-- (skor 0, tidak menggelembungkan NPK). Yang di-wire batch pertama: Revenue, AR,
-- Customer, CRM. KSO/GP/Coaching belum punya tabel sumber → selalu stub.

CREATE TABLE IF NOT EXISTS npk_am_score_semester (
  am_id         text        NOT NULL,
  year          int         NOT NULL,
  period        text        NOT NULL CHECK (period IN ('S1','S2')),  -- S1=Jan-Jun, S2=Jul-Des
  npk           numeric     NOT NULL DEFAULT 0,                      -- 0-100 (bobot tetap SK)
  predikat      text        NOT NULL CHECK (predikat IN
                  ('sangat_baik','baik','cukup','kurang','buruk')),
  computed_from jsonb       NOT NULL DEFAULT '{}'::jsonb,            -- input mentah + flag stub/proxy
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (am_id, year, period)
);

CREATE INDEX IF NOT EXISTS idx_npk_am_score_period ON npk_am_score_semester(year, period);

CREATE TABLE IF NOT EXISTS npk_am_aspect_score (
  am_id        text    NOT NULL,
  year         int     NOT NULL,
  period       text    NOT NULL,
  aspect       text    NOT NULL CHECK (aspect IN
                 ('revenue','customer','ar','kso','gp','crm','coaching')),
  raw          numeric,           -- skor mentah (bisa >100 sebelum cap)
  capped       numeric,           -- di-cap 0..120
  weight       int     NOT NULL,  -- bobot SK: 25/15/10/15/15/10/10
  contribution numeric,           -- capped × weight / 100
  available    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (am_id, year, period, aspect),
  FOREIGN KEY (am_id, year, period)
    REFERENCES npk_am_score_semester(am_id, year, period) ON DELETE CASCADE
);

-- Target jumlah customer aktif per AM (setahun) — sumber aspek "Customer Count
-- Growth" di level AM. Ditempel ke sales_target_am (047) yang sudah punya baris
-- per AM + UI-nya di menu Sales → Target, bukan tabel baru: satu tempat isi target
-- per AM. 0 = belum diisi → aspek customer available=false (bukan skor 0 palsu).
ALTER TABLE sales_target_am
  ADD COLUMN IF NOT EXISTS target_customer numeric NOT NULL DEFAULT 0;

-- Registrasi 2 menu di RBAC (pola sama 058). `npk-am` = matrix semua AM (HoD +
-- Direktur); `npk-am-self` = self-view staff AM/sales.
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('npk-am',      'NPK AM',            'Analytics', '/npk/am',      182),
  ('npk-am-self', 'NPK Saya (AM)',     'Analytics', '/npk/am-self', 183)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

-- Administrator: full. Operator: view+create+edit. Viewer: view only.
-- CATATAN: baris izin di sini hanya membuka GERBANG MENU. Baris data tetap
-- dibatasi scope server (repo/npk-am.ts visibleAms): staff AM hanya dirinya
-- sendiri walau grupnya diberi izin 'npk-am'.
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, true
FROM access_group g CROSS JOIN (VALUES ('npk-am'), ('npk-am-self')) AS f(key)
WHERE g.key = 'administrator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, true, true, false
FROM access_group g CROSS JOIN (VALUES ('npk-am'), ('npk-am-self')) AS f(key)
WHERE g.key = 'operator'
ON CONFLICT (group_id, feature_key) DO NOTHING;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, f.key, true, true, false, false, false
FROM access_group g CROSS JOIN (VALUES ('npk-am'), ('npk-am-self')) AS f(key)
WHERE g.key = 'viewer'
ON CONFLICT (group_id, feature_key) DO NOTHING;
