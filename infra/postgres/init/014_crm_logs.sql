-- Log operasional (port legacy delivery_log/email_log/alert_log). Append-only
-- catatan pengiriman WA, email, dan alert/notifikasi.
CREATE TABLE IF NOT EXISTS delivery_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source text, to_kind text, target text, text_preview text,
  delivered boolean NOT NULL DEFAULT false, attempts int NOT NULL DEFAULT 1,
  message_id_out text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind text NOT NULL, recipients jsonb NOT NULL DEFAULT '[]', subject text NOT NULL,
  range_from date, range_to date, delivered boolean NOT NULL DEFAULT false,
  message_id text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind text NOT NULL, level text NOT NULL DEFAULT 'info', title text NOT NULL,
  body text, payload jsonb NOT NULL DEFAULT '{}', channels_delivered jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_log_ts ON delivery_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_ts ON email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_log_ts ON alert_log (created_at DESC);
