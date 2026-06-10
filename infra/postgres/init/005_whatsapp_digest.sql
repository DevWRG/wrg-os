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

-- Anotasi sentiment + entity per wa_message hasil A8 (Sentiment & Entity
-- Extraction). Satu baris per pesan yang dianalisis.
CREATE TABLE IF NOT EXISTS message_annotation (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wa_message_id   UUID REFERENCES wa_message(id),
  group_jid       VARCHAR(100),
  sender_name     VARCHAR(200),
  sentiment       VARCHAR(10),   -- positive, neutral, negative
  sentiment_score NUMERIC(4,3),
  entities        JSONB DEFAULT '[]',  -- [{type, value}]
  generated_by    VARCHAR(10),   -- A8
  model_used      VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_annotation_msg ON message_annotation (wa_message_id);
