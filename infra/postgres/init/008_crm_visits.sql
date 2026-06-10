-- Visit report AM dengan geotag + foto (port legacy visit_geo + report_photo).
-- Foto disimpan sebagai URL + metadata (bukan binary). geo_status hasil
-- verifikasi: bounds Indonesia (lat -11..6, lon 95..141) + date-mismatch.
CREATE TABLE IF NOT EXISTS visit (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id         UUID REFERENCES deal(deal_id),
  am_id           VARCHAR(50) NOT NULL,
  customer_name   VARCHAR(200),
  photo_url       TEXT,
  visit_lat       NUMERIC(9,6),
  visit_lon       NUMERIC(9,6),
  visit_timestamp TIMESTAMPTZ,
  visit_date      DATE,                -- tanggal kunjungan yang diklaim
  geo_status      VARCHAR(20),         -- ok | out_of_bounds | no_geo | date_mismatch
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visit_am ON visit (am_id);
CREATE INDEX IF NOT EXISTS idx_visit_status ON visit (geo_status);
