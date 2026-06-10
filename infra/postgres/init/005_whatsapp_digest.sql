-- D1b WhatsApp & Digest (cross-domain feed)
CREATE TABLE IF NOT EXISTS wa_message (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_jid       VARCHAR(100) NOT NULL,
  group_name      VARCHAR(200),
  sender_jid      VARCHAR(100),
  sender_name     VARCHAR(200),
  message_type    VARCHAR(20) DEFAULT 'text',
  body            TEXT,
  input_hash      VARCHAR(64),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_message_group ON wa_message(group_jid, received_at DESC);

CREATE TABLE IF NOT EXISTS digest_rekap (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_jid       VARCHAR(100) NOT NULL,
  group_name      VARCHAR(200),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  bullets         JSONB DEFAULT '[]',
  action_items    JSONB DEFAULT '[]',
  konfirmasi_items JSONB DEFAULT '[]',
  raw_output      TEXT,
  model_used      VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS digest_resume (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_date     DATE NOT NULL,
  period_type     VARCHAR(10) NOT NULL,  -- morning, evening
  sections        JSONB DEFAULT '{}',
  raw_output      TEXT,
  model_used      VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS digest_briefing (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_start      DATE NOT NULL,
  sections        JSONB DEFAULT '{}',
  raw_output      TEXT,
  model_used      VARCHAR(50),
  hitl_status     VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
