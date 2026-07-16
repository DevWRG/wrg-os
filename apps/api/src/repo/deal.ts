import { db } from "../db.js";
import type { PlanCustomer } from "../parsers/plan.js";
import type { ReportItem } from "../parsers/report.js";

// Jembatan parser CRM (legacy #PLAN/#REPORT) ke schema kanonik D1 (deal/spt_state_log).
// MAPPING:
//   #PLAN   → upsert `deal` per (am_id, customer). Customer baru → deal stage 'Cold'
//             (intent to engage = pipeline entry). tujuan+goal → notes.
//   #REPORT → fuzzy-match (pg_trgm) ke deal milik AM, lalu catat `spt_state_log`
//             (touch). Kalau body kasih `to_stage` valid → transisi stage + update deal.

const AUTO = 0.7;
const AMBIGUOUS = 0.4;
// F1-SPT: 8-stage kanonik (selaras enum deal_stage migrasi 057). Ganti stage lama.
const CLOSED = ["Closing-Won", "Closing-Lost"];
export const DEAL_STAGES = [
  "Prospecting",
  "First Contact",
  "Presentation",
  "Quotation",
  "Offering",
  "Negotiation",
  "Closing-Won",
  "Closing-Lost",
];

function custId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "unknown"
  );
}

export interface PipelineDeal {
  deal_id: string;
  customer_name: string;
  am_id: string;
  estimated_value: number | null;
  updated_at: string;
}

export interface PipelineStage {
  stage: string;
  count: number;
  total_value: number;
  deals: PipelineDeal[];
}

export async function getPipeline(
  amId?: string,
): Promise<{ stages: PipelineStage[]; total_deals: number; total_value: number }> {
  const sql = db();
  // F1-SPT: value pakai estimate_amount (kolom SPT) kalau estimated_value (WA lama) kosong.
  const rows = amId
    ? await sql`SELECT deal_id, customer_name, am_id, stage, COALESCE(estimated_value, estimate_amount) AS estimated_value, updated_at FROM deal WHERE am_id = ${amId} ORDER BY updated_at DESC`
    : await sql`SELECT deal_id, customer_name, am_id, stage, COALESCE(estimated_value, estimate_amount) AS estimated_value, updated_at FROM deal ORDER BY updated_at DESC`;

  const byStage = new Map<string, PipelineDeal[]>();
  for (const s of DEAL_STAGES) byStage.set(s, []);
  let totalValue = 0;
  for (const r of rows) {
    const val = r.estimated_value != null ? Number(r.estimated_value) : null;
    const d: PipelineDeal = {
      deal_id: String(r.deal_id),
      customer_name: String(r.customer_name),
      am_id: String(r.am_id),
      estimated_value: val,
      updated_at: String(r.updated_at),
    };
    if (!byStage.has(String(r.stage))) byStage.set(String(r.stage), []);
    byStage.get(String(r.stage))!.push(d);
    totalValue += val ?? 0;
  }
  const stages: PipelineStage[] = [...byStage.entries()].map(([stage, deals]) => ({
    stage,
    count: deals.length,
    total_value: deals.reduce((a, d) => a + (d.estimated_value ?? 0), 0),
    deals,
  }));
  return { stages, total_deals: rows.length, total_value: totalValue };
}

export interface PlanDealResult {
  customer: string;
  deal_id: string;
  stage: string;
  created: boolean;
}

export async function upsertDealsFromPlan(
  amId: string,
  customers: PlanCustomer[],
): Promise<PlanDealResult[]> {
  const sql = db();
  const out: PlanDealResult[] = [];
  for (const c of customers) {
    const existing = await sql`
      SELECT deal_id, stage FROM deal
      WHERE am_id = ${amId} AND customer_name = ${c.customer}
        AND stage NOT IN ${sql(CLOSED)}
      ORDER BY updated_at DESC LIMIT 1
    `;
    const notes = `[${c.tujuan}] ${c.goal}`.trim();
    if (existing.length > 0) {
      await sql`UPDATE deal SET notes = ${notes}, updated_at = now() WHERE deal_id = ${existing[0].deal_id}`;
      out.push({ customer: c.customer, deal_id: existing[0].deal_id as string, stage: existing[0].stage as string, created: false });
    } else {
      const rows = await sql`
        INSERT INTO deal (customer_id, customer_name, am_id, stage, notes)
        VALUES (${custId(c.customer)}, ${c.customer}, ${amId}, 'Prospecting', ${notes})
        RETURNING deal_id, stage
      `;
      out.push({ customer: c.customer, deal_id: rows[0].deal_id as string, stage: rows[0].stage as string, created: true });
    }
  }
  return out;
}

export interface ReportDealMatch {
  customer: string;
  hasil: string;
  next_action: string;
  match: {
    kind: "auto" | "ambiguous" | "unmatched";
    deal_id: string | null;
    score: number;
    candidates: { deal_id: string; customer_name: string; score: number }[];
  };
  state_log_id: string | null;
  stage: string | null;
}

/**
 * Catat hasil report ke satu deal eksplisit: spt_state_log (touch) + update deal.
 * Dipakai jalur auto (logReportToDeals) DAN saat ambiguous di-approve via HITL.
 */
export async function recordReportTouch(
  amId: string,
  dealId: string,
  hasil: string,
  nextAction: string,
  toStage?: string,
): Promise<{ state_log_id: string; stage: string }> {
  const sql = db();
  const cur = await sql`SELECT stage FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new Error("deal tidak ditemukan");
  const fromStage = cur[0].stage as string;
  const target = toStage && DEAL_STAGES.includes(toStage) ? toStage : fromStage;
  const rows = await sql`
    INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
    VALUES (${dealId}, ${fromStage}, ${target}, ${amId}, ${`${hasil} | next: ${nextAction}`})
    RETURNING id
  `;
  if (target !== fromStage) {
    await sql`UPDATE deal SET stage = ${target}, updated_at = now() WHERE deal_id = ${dealId}`;
  } else {
    await sql`UPDATE deal SET updated_at = now() WHERE deal_id = ${dealId}`;
  }
  return { state_log_id: rows[0].id as string, stage: target };
}

export async function logReportToDeals(
  amId: string,
  items: ReportItem[],
  toStage?: string,
): Promise<ReportDealMatch[]> {
  const sql = db();
  const out: ReportDealMatch[] = [];
  for (const it of items) {
    const cands = await sql`
      SELECT deal_id, customer_name, stage, similarity(customer_name, ${it.customer}) AS score
      FROM deal
      WHERE am_id = ${amId} AND similarity(customer_name, ${it.customer}) > 0.25
      ORDER BY score DESC LIMIT 3
    `;
    const top = cands[0];
    const candidates = cands.map((r) => ({
      deal_id: r.deal_id as string,
      customer_name: r.customer_name as string,
      score: Number(r.score),
    }));

    let kind: "auto" | "ambiguous" | "unmatched";
    let dealId: string | null = null;
    let stateLogId: string | null = null;
    let stage: string | null = null;

    if (!top || Number(top.score) < AMBIGUOUS) {
      kind = "unmatched";
    } else if (Number(top.score) >= AUTO) {
      kind = "auto";
      dealId = top.deal_id as string;
      const r = await recordReportTouch(amId, dealId, it.hasil, it.next_action, toStage);
      stateLogId = r.state_log_id;
      stage = r.stage;
    } else {
      kind = "ambiguous";
    }

    out.push({
      customer: it.customer,
      hasil: it.hasil,
      next_action: it.next_action,
      match: { kind, deal_id: dealId, score: Number(top?.score ?? 0), candidates },
      state_log_id: stateLogId,
      stage,
    });
  }
  return out;
}
