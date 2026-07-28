-- 067 — WatchPoint Weekly: snapshot metric per HoD per MINGGU ISO.
--
-- Papan WatchPoint (040) bersifat "sekarang": nilainya dihitung live tiap request
-- sehingga riwayat hilang. Tabel ini menyimpan nilai per minggu supaya:
--   1. Minggu lewat tetap bisa dibuka apa adanya (bukan dihitung ulang hari ini).
--   2. Trend antar-minggu (naik/turun) punya pembanding nyata, bukan hardcoded.
--   3. Deck PPT mingguan (Export PPTX) direproduksi persis dari data tersimpan.
--
-- Dua jenis baris, dibedakan `source`:
--   'db'     — hasil snapshot metric computed (dibekukan saat minggu ditutup).
--   'manual' — diisi HoD lewat UI Weekly (metric yang tak bisa dihitung: uptime,
--              lead time install, JV, CLIA, dsb).
-- Manual selalu menang atas snapshot db untuk metric yang sama (lihat
-- apps/api/src/repo/watchpoint-weekly.ts).
--
-- Sengaja kosong di awal: minggu tanpa baris → metric N/A untuk minggu lewat,
-- dan nilai live untuk minggu berjalan.

CREATE TABLE IF NOT EXISTS watchpoint_weekly (
  hod_key    text    NOT NULL,
  iso_year   int     NOT NULL,
  iso_week   int     NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  metric_key text    NOT NULL,
  target     numeric,                                   -- target saat itu (bisa berubah antar minggu)
  actual     numeric,                                   -- NULL utk metric kualitatif/milestone
  status     text CHECK (status IN ('GREEN','YELLOW','RED','NA')),  -- override; NULL → gate dari target vs actual
  note       text,                                      -- kolom KETERANGAN di deck
  source     text    NOT NULL DEFAULT 'manual' CHECK (source IN ('db','manual')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hod_key, iso_year, iso_week, metric_key)
);

CREATE INDEX IF NOT EXISTS watchpoint_weekly_week_idx
  ON watchpoint_weekly (iso_year DESC, iso_week DESC);

COMMENT ON TABLE watchpoint_weekly IS
  'WatchPoint Weekly — nilai metric per HoD per minggu ISO (snapshot db + input manual HoD).';
