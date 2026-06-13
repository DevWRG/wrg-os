-- 030_competitor_extraction_state.sql — idempotensi extract_competitor.
-- Tandai activity_log yang sudah di-ekstrak (port competitor_extraction_state
-- legacy) supaya tidak re-LLM tiap run.
CREATE TABLE IF NOT EXISTS competitor_extraction_state (
  activity_id      BIGINT PRIMARY KEY,
  n_mentions       INTEGER NOT NULL DEFAULT 0,
  extracted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  extraction_model TEXT
);
