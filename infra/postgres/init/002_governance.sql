-- D6 Governance & Audit (HARUS ada duluan sebelum domain lain)
-- Semua tabel transaksional akan FK ke audit_log

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id        VARCHAR(10) PRIMARY KEY,  -- A1..A12
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  version         VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  r_tier          VARCHAR(2) NOT NULL DEFAULT 'R1',
  hitl_level      VARCHAR(2) NOT NULL DEFAULT 'L2',
  token_tier      VARCHAR(10),
  use_case_owner  VARCHAR(100),
  technical_owner VARCHAR(100),
  governance_owner VARCHAR(100),
  status          VARCHAR(20) NOT NULL DEFAULT 'experimental',
  eval_score      DECIMAL(5,2),
  last_health_check TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  use_case_id     VARCHAR(100) NOT NULL,
  session_id      VARCHAR(100),
  correlation_id  VARCHAR(100),
  agent_id        VARCHAR(10) REFERENCES agent_registry(agent_id),
  layer           SMALLINT NOT NULL,  -- 1=Identity, 2=Input, 3=Reasoning, 4=Output, 5=Human
  event_type      VARCHAR(100) NOT NULL,
  r_tier          VARCHAR(2),
  input_hash      VARCHAR(64),   -- sha256
  output_hash     VARCHAR(64),   -- sha256
  payload         JSONB,
  human_actor     VARCHAR(100),
  decision        VARCHAR(20),   -- approve/reject/modify
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- append-only: prevent UPDATE/DELETE
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS hitl_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correlation_id  VARCHAR(100) NOT NULL,
  agent_id        VARCHAR(10),
  r_tier          VARCHAR(2) NOT NULL,
  hitl_level      VARCHAR(2) NOT NULL,
  payload         JSONB NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  approver_id     VARCHAR(100),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  adr_number      VARCHAR(20),
  title           VARCHAR(200) NOT NULL,
  decision        TEXT NOT NULL,
  rationale       TEXT,
  status          VARCHAR(20) DEFAULT 'PENDING',
  decided_by      VARCHAR(100),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed agent registry (12 agents dari Blueprint v2.3)
INSERT INTO agent_registry (agent_id, name, r_tier, hitl_level, token_tier, status) VALUES
  ('A1', 'Distillation Cascade', 'R1', 'L2', 'LOW', 'active'),
  ('A2', 'AR Aging Watch', 'R1', 'L2', 'MED', 'active'),
  ('A3', 'Sari Collection Drafter', 'R2', 'L2', 'MED', 'experimental'),
  ('A4', 'Pipeline Authenticity', 'R2', 'L3', 'MED', 'experimental'),
  ('A5', 'Anomaly Detection', 'R2', 'L3', 'MED', 'experimental'),
  ('A6', 'Sales Doc Drafter', 'R2', 'L2', 'HIGH', 'experimental'),
  ('A7', 'Product Intelligence', 'R1', 'L2', 'LOW', 'experimental'),
  ('A8', 'Sentiment & Entity Extraction', 'R1', 'L2', 'LOW', 'experimental'),
  ('A9', 'Spider Network Analyst', 'R1', 'L2', 'MED', 'experimental'),
  ('A10', 'Executive Synthesis', 'R1', 'L2', 'HIGH', 'experimental'),
  ('A11', 'Coaching Outcome Synthesis', 'R1', 'L2', 'MED', 'experimental'),
  ('A12', 'People Analytics Agent', 'R1', 'L2', 'MED', 'experimental')
ON CONFLICT (agent_id) DO NOTHING;

COMMENT ON TABLE audit_log IS 'WRG-OS Audit 5-layer append-only log. Retensi 7 tahun (PSAK). NO UPDATE/DELETE.';
COMMENT ON TABLE hitl_queue IS 'HITL gate queue. Output R1+ tidak boleh langsung keluar tanpa approval.';
