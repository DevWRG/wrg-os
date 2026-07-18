-- 059 — F66 NPK Engine: detail skor per aspek (7 aspek SK Pasal 3.1). Satu baris
-- per (hod, semester, aspek). `available=false` → aspek belum punya sumber data live
-- (di-skor 0, tak menaikkan NPK) — UI menandai "N/A" bukan angka palsu. Additive.

CREATE TABLE IF NOT EXISTS npk_aspect_score (
  hod_key      text    NOT NULL,
  year         int     NOT NULL,
  period       text    NOT NULL,
  aspect       text    NOT NULL CHECK (aspect IN
                 ('revenue','customer','ar','kso','gp','crm','coaching')),
  raw          numeric,           -- skor mentah (bisa >100 sebelum cap)
  capped       numeric,           -- di-cap 0..120
  weight       int     NOT NULL,  -- bobot SK: 25/15/10/15/15/10/10
  contribution numeric,           -- capped × weight / 100 (sumbangsih ke NPK)
  available    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (hod_key, year, period, aspect),
  FOREIGN KEY (hod_key, year, period)
    REFERENCES npk_score_semester(hod_key, year, period) ON DELETE CASCADE
);
