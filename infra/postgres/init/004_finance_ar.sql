-- D2 Finance & AR
CREATE TABLE IF NOT EXISTS ar_aging_mv (
  customer_id     VARCHAR(50) NOT NULL,
  customer_name   VARCHAR(200),
  invoice_no      VARCHAR(50) NOT NULL,
  due_date        DATE NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  days_overdue    INTEGER NOT NULL DEFAULT 0,
  bucket          VARCHAR(10) NOT NULL,  -- current, 1-30, 31-60, 61-90, 90+
  is_anomaly      BOOLEAN DEFAULT FALSE,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS collection_draft (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     VARCHAR(50) NOT NULL,
  invoice_no      VARCHAR(50),
  draft_text      TEXT NOT NULL,
  draft_type      VARCHAR(20),  -- whatsapp, email, formal_letter
  status          VARCHAR(20) DEFAULT 'draft',  -- draft, approved, sent
  generated_by    VARCHAR(10),  -- A3
  approved_by     VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accurate_webhook_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type      VARCHAR(100) NOT NULL,
  payload         JSONB NOT NULL,
  input_hash      VARCHAR(64),
  processed       BOOLEAN DEFAULT FALSE,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
