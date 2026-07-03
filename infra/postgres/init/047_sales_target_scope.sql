-- 047 — Target penjualan per Cabang & per AM (tahunan). Independen dari target
-- region (sales_region_target, 046) — koeksis, tidak auto roll-up. Region East/West
-- untuk cabang/AM SELALU diturunkan dari cabang via hod_territory (tidak disimpan).

CREATE TABLE IF NOT EXISTS sales_target_cabang (
  year       int         NOT NULL,
  cabang     text        NOT NULL,
  target     numeric     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, cabang)
);

CREATE TABLE IF NOT EXISTS sales_target_am (
  year       int         NOT NULL,
  am_id      text        NOT NULL,
  target     numeric     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, am_id)
);
