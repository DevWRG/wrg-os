-- CRM reminder AM (port legacy/crm am_reminder). AM nitip "note: TGL ket" →
-- reminder; di-fire H-1 sore + H pagi ke grup WA, idempoten via flag fired_*.
CREATE TABLE IF NOT EXISTS am_reminder (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  am_id           VARCHAR(50) NOT NULL,
  am_name         VARCHAR(200),
  reminder_date   DATE NOT NULL,
  note            TEXT NOT NULL,
  customer_name   VARCHAR(200),
  fired_h_minus_1 BOOLEAN NOT NULL DEFAULT FALSE,
  fired_h         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_am_reminder_date ON am_reminder (reminder_date);
