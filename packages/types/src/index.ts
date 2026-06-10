// WRG-OS Shared Types — sesuai Blueprint v2.3

// === Agent Types ===
export type AgentId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A10" | "A11" | "A12";
export type RTier = "R0" | "R1" | "R2" | "R3" | "R4";
export type HITLLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type AgentStatus = "experimental" | "active" | "paused" | "retired";

export interface AgentRegistryEntry {
  agent_id: AgentId;
  name: string;
  description: string;
  version: string;
  r_tier: RTier;
  hitl_level: HITLLevel;
  use_case_owner: string;
  technical_owner: string;
  governance_owner: string;
  status: AgentStatus;
  eval_score?: number;
  last_health_check?: string;
}

// === Event Envelope (ADR-024) ===
export interface EventEnvelope<T = unknown> {
  event_id: string;          // uuid-v7
  correlation_id: string;    // = session_id
  causation_id: string;      // event pemicu
  type: string;              // e.g. "accurate.invoice.owing.v1"
  source: string;
  occurred_at: string;       // ISO-8601
  use_case_id: string;
  r_tier: RTier;
  schema_version: string;
  payload: T;
  input_hash: string;        // sha256(payload)
}

// === Deal / CRM (D1) ===
export type DealStage =
  | "Cold"
  | "Follow Up"
  | "SPH"
  | "Offering Letter"
  | "Presentation"
  | "Negotiating"
  | "Deal"
  | "MOU"
  | "Lose";

export interface Deal {
  deal_id: string;
  customer_id: string;
  am_id: string;
  stage: DealStage;
  product_ids: string[];
  estimated_value: number;
  created_at: string;
  updated_at: string;
}

// === AR Aging (D2) ===
export type ARBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export interface ARAgingEntry {
  customer_id: string;
  customer_name: string;
  invoice_no: string;
  due_date: string;
  amount: number;
  bucket: ARBucket;
  days_overdue: number;
}

// === Digest (A1) ===
export interface DigestRekap {
  group_jid: string;
  group_name: string;
  period_start: string;
  period_end: string;
  bullets: string[];
  action_items: string[];
  konfirmasi_items: string[];
  created_at: string;
}
