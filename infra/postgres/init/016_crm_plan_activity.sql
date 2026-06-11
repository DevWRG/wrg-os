-- Sumber metrik Plan & Report WRG-CRM: sales_plan (rencana kunjungan AM +
-- geotag) & activity_log (eksekusi/aktivitas, matched/unmatched ke plan), plus
-- sales_todo.report_data (hasil report per-item, jsonb). Diperlukan dashboard
-- replikasi WRG-CRM (KPI strip, per-orang/HOD, daily-trend, drilldown).
--
-- id legacy (integer) dipertahankan sbg BIGINT karena dipakai relasi silang:
--   sales_plan.activity_id  -> activity_log.id
--   activity_log.plan_id    -> sales_plan.id
-- Relasi dibiarkan tanpa FK keras (circular + sebagian am_id sudah non-aktif),
-- konsisten dgn tabel CRM lain yang tak ber-FK ke master_user. am_id = VARCHAR
-- (samakan dgn master_user.am_id & sales_todo.am_id).

CREATE TABLE IF NOT EXISTS sales_plan (
  id                 BIGINT PRIMARY KEY,
  am_id              VARCHAR(50) NOT NULL,
  tanggal            DATE NOT NULL,
  customer_name      TEXT,
  tujuan             TEXT,
  goal               TEXT,
  seq                INTEGER,
  reported           BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at        TIMESTAMPTZ,
  activity_id        BIGINT,
  is_late_plan       BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at       TIMESTAMPTZ,
  visit_lat          NUMERIC(9,6),
  visit_lon          NUMERIC(9,6),
  visit_timestamp    TIMESTAMPTZ,
  visit_date_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_plan_am_tanggal_idx ON sales_plan (am_id, tanggal);
CREATE INDEX IF NOT EXISTS sales_plan_tanggal_idx ON sales_plan (tanggal);

CREATE TABLE IF NOT EXISTS activity_log (
  id            BIGINT PRIMARY KEY,
  am_id         VARCHAR(50) NOT NULL,
  plan_id       BIGINT,
  tanggal       DATE NOT NULL,
  customer_name TEXT,
  tujuan        TEXT,
  hasil         TEXT,
  next_action   TEXT,
  source        TEXT,
  is_unmatched  BOOLEAN NOT NULL DEFAULT FALSE,
  match_score   NUMERIC,
  todo_id       BIGINT,
  todo_item_idx INTEGER,
  message_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activity_log_am_tanggal_idx ON activity_log (am_id, tanggal);
CREATE INDEX IF NOT EXISTS activity_log_plan_id_idx ON activity_log (plan_id);

-- report_data: hasil parse #REPORT per item (status matched/ambiguous/unmatched),
-- dipakai menghitung Reported/Unmatched untuk non-AM (sales_todo).
ALTER TABLE sales_todo ADD COLUMN IF NOT EXISTS report_data JSONB;
