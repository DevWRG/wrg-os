-- D1 Sales & CRM
CREATE TABLE IF NOT EXISTS deal (
  deal_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     VARCHAR(50) NOT NULL,
  customer_name   VARCHAR(200),
  am_id           VARCHAR(50) NOT NULL,
  stage           VARCHAR(30) NOT NULL DEFAULT 'Cold',
  estimated_value DECIMAL(15,2),
  product_ids     JSONB DEFAULT '[]',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigram index utk fuzzy match #REPORT → deal (pg_trgm similarity).
CREATE INDEX IF NOT EXISTS idx_deal_customer_trgm ON deal USING gin (customer_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS spt_state_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id         UUID REFERENCES deal(deal_id),
  from_stage      VARCHAR(30),
  to_stage        VARCHAR(30) NOT NULL,
  changed_by      VARCHAR(50),
  reason          TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_target (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_id           VARCHAR(50) NOT NULL,
  period          VARCHAR(7) NOT NULL,  -- YYYY-MM
  target_revenue  DECIMAL(15,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sps_mv (
  am_id           VARCHAR(50) NOT NULL,
  period          VARCHAR(7) NOT NULL,
  target_revenue  DECIMAL(15,2),
  actual_revenue  DECIMAL(15,2),
  achievement_pct DECIMAL(5,2),
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (am_id, period)
);
