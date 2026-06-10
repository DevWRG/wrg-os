-- Daily TODO/plan checklist per AM (port legacy sales_todo). Satu plan per AM
-- per tanggal (unik); items = array kegiatan; is_late_plan bila submit >08:00.
CREATE TABLE IF NOT EXISTS sales_todo (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_id         VARCHAR(50) NOT NULL,
  am_name       VARCHAR(200),
  tanggal       DATE NOT NULL,
  items         JSONB NOT NULL DEFAULT '[]',
  total_items   INT GENERATED ALWAYS AS (jsonb_array_length(items)) STORED,
  raw_body      TEXT,
  is_late_plan  BOOLEAN NOT NULL DEFAULT FALSE,
  reported      BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_todo_am_tgl_unique UNIQUE (am_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_sales_todo_am_tgl ON sales_todo (am_id, tanggal);
