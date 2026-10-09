-- 198 — Master HoD: satu daftar HoD kanonik di DB.
--
-- Sebelumnya daftar 8 HoD ditulis ulang di kode di 5+ tempat (hod-resolver.ts
-- HODS, watchpoint.ts HOD_DEFS, web hod-options.ts, approval-requests config,
-- overtime-board) dan isinya sudah menyimpang: HoD Aftersales ber-key `muhid`
-- di resolver/NPK/approval tapi `pakMuhid` di WatchPoint. Akibatnya data
-- WatchPoint Muhid tak pernah tersambung ke NPK/approval-nya, dan pergantian
-- HoD butuh deploy. Sekarang tabel ini satu-satunya sumber; kode membaca dari
-- sini (API: repo/master-hod.ts, web: /api/hods).
--
-- Yang TETAP di kode, dengan sengaja: katalog metric WatchPoint per hod_key
-- (rumus compute = logika, bukan data) dan pemetaan approver PO per lini
-- (aturan bisnis). Keduanya merujuk hod_key dari tabel ini.
--
-- Kolom:
--   nama           nama tampilan lengkap (Org Chart, NPK)
--   panggilan      nama pendek (WatchPoint, dropdown)
--   peran          area tanggung jawab tanpa awalan "HoD", mis. 'Sales East'
--   alias          nama/ejaan yang dikenali resolver atasan_raw (huruf kecil)
--   petunjuk_peran frasa peran yang dikenali resolver (huruf kecil)

CREATE TABLE IF NOT EXISTS master_hod (
  hod_key         text PRIMARY KEY,
  nama            text NOT NULL,
  panggilan       text NOT NULL,
  peran           text NOT NULL,
  alias           text[] NOT NULL DEFAULT '{}',
  petunjuk_peran  text[] NOT NULL DEFAULT '{}',
  urutan          int  NOT NULL DEFAULT 100,
  aktif           boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Isi awal = gabungan HODS (resolver) + HOD_DEFS (WatchPoint). Urutan mengikuti
-- WatchPoint (urutan papan yang sudah dikenal Direktur). DO NOTHING: baris yang
-- sudah diubah admin tak ditimpa kalau migrasi ini terjalan ulang.
INSERT INTO master_hod (hod_key, nama, panggilan, peran, alias, petunjuk_peran, urutan) VALUES
  ('rocky', 'Rocky Gunawan', 'Rocky', 'Sales East',            '{rocky,roki,roky}', '{"hod sales east","sales east"}', 10),
  ('yogi',  'Yogi',          'Yogi',  'Sales West',            '{yogi}',            '{"hod sales west","sales west"}', 20),
  ('mufid', 'Mufid',         'Mufid', 'Business IVD',          '{mufid}',           '{"business ivd","hod business ivd"}', 30),
  ('arman', 'Arman',         'Arman', 'Business Medical & HD', '{arman}',           '{"business medical","hod business medical"}', 40),
  ('muhid', 'Muhid',         'Muhid', 'Aftersales',            '{muhid,muhit}',     '{"hod aftersales",aftersales}', 50),
  ('ika',   'Ika',           'Ika',   'Finance & SC',          '{ika}',             '{"hod finance","finance & sc","finance dan sc"}', 60),
  ('fafa',  'Fafa',          'Fafa',  'Accounting & Tax',      '{fafa}',            '{"hod accounting","acc & tax","accounting & tax","acc&tax","acc tax"}', 70),
  ('husni', 'Husni',         'Husni', 'BD & GA',               '{husni}',           '{"hod bd","bd & ga","bd&ga","bd/ga"}', 80)
ON CONFLICT (hod_key) DO NOTHING;

-- Satukan key Aftersales: `pakMuhid` (hanya WatchPoint) → `muhid` (kanonik).
-- Prod 9 Okt 2026: 10 baris watchpoint_weekly ber-`pakMuhid`, nol baris `muhid`
-- di tabel WatchPoint, jadi PK tak bertabrakan. NOT EXISTS tetap dipasang supaya
-- migrasi aman di DB mana pun (baris yang bentrok dibiarkan, tidak gagal).
UPDATE watchpoint_weekly w SET hod_key = 'muhid'
WHERE w.hod_key = 'pakMuhid'
  AND NOT EXISTS (SELECT 1 FROM watchpoint_weekly x
                  WHERE x.hod_key = 'muhid' AND x.iso_year = w.iso_year
                    AND x.iso_week = w.iso_week AND x.metric_key = w.metric_key);

UPDATE watchpoint_metric w SET hod_key = 'muhid'
WHERE w.hod_key = 'pakMuhid'
  AND NOT EXISTS (SELECT 1 FROM watchpoint_metric x
                  WHERE x.hod_key = 'muhid' AND x.metric_key = w.metric_key);

UPDATE hod_territory t SET hod_key = 'muhid'
WHERE t.hod_key = 'pakMuhid'
  AND NOT EXISTS (SELECT 1 FROM hod_territory x
                  WHERE x.hod_key = 'muhid' AND x.cabang = t.cabang);

GRANT SELECT, INSERT, UPDATE, DELETE ON master_hod TO wrg_app;
GRANT SELECT ON master_hod TO wrg_readonly;
