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
  facility_name: string | null;
  am_id: string | null;
  brand: string | null;
  product: string | null;
  product_category: string | null;    // IVD / Medical
  prospect_category: string | null;    // Cold / Warm / Hot
  stage: string;
  probability: number | null;
  forecast_category: string | null;
  estimate_amount: number | null;
  weighted: number;                    // estimate_amount × probability(stage)
  pic_hod: string | null;
  cabang: string | null;
  coop_model: string | null;
  city: string | null;
  province: string | null;
  purchase_year: number | null;
  days_in_stage: number | null;
  stale: boolean;                      // >14 hari di stage non-terminal
  notes: string | null;
  updated_at: string;
}

export interface PipelineStage {
  stage: string;
  count: number;
  total_value: number;
  weighted_value: number;
  deals: PipelineDeal[];
}

export interface PipelineSummary {
  total_deals: number;
  total_value: number;
  weighted_value: number;
  stale_count: number;
  by_forecast: { forecast: string; count: number; value: number }[];
}

// F1-SPT read model: board by 8-stage + weighted (estimate×prob) + stale flag + summary.
export async function getPipeline(
  amId?: string,
): Promise<{ stages: PipelineStage[]; summary: PipelineSummary; total_deals: number; total_value: number }> {
  const sql = db();
  const cols = sql`deal_id, customer_name, facility_name, am_id, brand, product, product_category,
    prospect_category, stage, probability, forecast_category,
    COALESCE(estimated_value, estimate_amount) AS estimate_amount,
    pic_hod, cabang, coop_model, city, province, purchase_year, notes, updated_at,
    GREATEST(0, EXTRACT(DAY FROM (now() - stage_entered_at))::int) AS days_in_stage`;
  const rows = amId
    ? await sql`SELECT ${cols} FROM deal WHERE am_id = ${amId} ORDER BY updated_at DESC`
    : await sql`SELECT ${cols} FROM deal ORDER BY updated_at DESC`;

  const TERMINAL = new Set(["Closing-Won", "Closing-Lost"]);
  const byStage = new Map<string, PipelineDeal[]>();
  for (const s of DEAL_STAGES) byStage.set(s, []);
  let totalValue = 0, weightedTotal = 0, staleCount = 0;
  const byForecast = new Map<string, { count: number; value: number }>();

  for (const r of rows) {
    const stage = String(r.stage);
    const est = r.estimate_amount != null ? Number(r.estimate_amount) : null;
    const prob = r.probability != null ? Number(r.probability) : null;
    const weighted = (est ?? 0) * (prob ?? 0);
    const dis = r.days_in_stage != null ? Number(r.days_in_stage) : null;
    const stale = !TERMINAL.has(stage) && dis != null && dis > 14;
    if (stale) staleCount += 1;
    const d: PipelineDeal = {
      deal_id: String(r.deal_id),
      customer_name: String(r.customer_name ?? ""),
      facility_name: r.facility_name ? String(r.facility_name) : null,
      am_id: r.am_id ? String(r.am_id) : null,
      brand: r.brand ? String(r.brand) : null,
      product: r.product ? String(r.product) : null,
      product_category: r.product_category ? String(r.product_category) : null,
      prospect_category: r.prospect_category ? String(r.prospect_category) : null,
      stage,
      probability: prob,
      forecast_category: r.forecast_category ? String(r.forecast_category) : null,
      estimate_amount: est,
      weighted,
      pic_hod: r.pic_hod ? String(r.pic_hod) : null,
      cabang: r.cabang ? String(r.cabang) : null,
      coop_model: r.coop_model ? String(r.coop_model) : null,
      city: r.city ? String(r.city) : null,
      province: r.province ? String(r.province) : null,
      purchase_year: r.purchase_year != null ? Number(r.purchase_year) : null,
      days_in_stage: dis,
      stale,
      notes: r.notes ? String(r.notes) : null,
      updated_at: String(r.updated_at),
    };
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(d);
    totalValue += est ?? 0;
    weightedTotal += weighted;
    const fc = d.forecast_category ?? "—";
    const cur = byForecast.get(fc) ?? { count: 0, value: 0 };
    cur.count += 1; cur.value += est ?? 0;
    byForecast.set(fc, cur);
  }
  const stages: PipelineStage[] = [...byStage.entries()].map(([stage, deals]) => ({
    stage,
    count: deals.length,
    total_value: deals.reduce((a, d) => a + (d.estimate_amount ?? 0), 0),
    weighted_value: deals.reduce((a, d) => a + d.weighted, 0),
    deals,
  }));
  const summary: PipelineSummary = {
    total_deals: rows.length,
    total_value: totalValue,
    weighted_value: weightedTotal,
    stale_count: staleCount,
    by_forecast: [...byForecast.entries()]
      .map(([forecast, v]) => ({ forecast, count: v.count, value: v.value }))
      .sort((a, b) => b.value - a.value),
  };
  return { stages, summary, total_deals: rows.length, total_value: totalValue };
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
