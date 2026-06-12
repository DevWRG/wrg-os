-- WRG Monitor — profil pola komunikasi per grup WhatsApp (markdown), hasil
-- profiling AI harian. Sumber legacy: data/pola/<group_jid>.md.
CREATE TABLE IF NOT EXISTS monitor_pola (
  group_jid   VARCHAR(120) PRIMARY KEY,
  group_name  TEXT,
  content     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
