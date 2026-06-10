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
const CLOSED = ["Deal", "MOU", "Lose"];
export const DEAL_STAGES = [
  "Cold",
  "Follow Up",
  "SPH",
  "Offering Letter",
  "Presentation",
  "Negotiating",
  "Deal",
  "MOU",
  "Lose",
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
        VALUES (${custId(c.customer)}, ${c.customer}, ${amId}, 'Cold', ${notes})
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

export async function logReportToDeals(
  amId: string,
  items: ReportItem[],
  toStage?: string,
): Promise<ReportDealMatch[]> {
  const sql = db();
  const target = toStage && DEAL_STAGES.includes(toStage) ? toStage : null;
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
      const fromStage = top.stage as string;
      const to = target ?? fromStage; // touch (no-op) atau transisi
      const rows = await sql`
        INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
        VALUES (${dealId}, ${fromStage}, ${to}, ${amId}, ${`${it.hasil} | next: ${it.next_action}`})
        RETURNING id
      `;
      stateLogId = rows[0].id as string;
      stage = to;
      if (to !== fromStage) {
        await sql`UPDATE deal SET stage = ${to}, updated_at = now() WHERE deal_id = ${dealId}`;
      } else {
        await sql`UPDATE deal SET updated_at = now() WHERE deal_id = ${dealId}`;
      }
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
