import { db } from "../db.js";
import type { PlanCustomer } from "../parsers/plan.js";
import type { ReportItem } from "../parsers/report.js";
import { type DataScope, isRestricted } from "./access-scope.js";

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

// F1-SPT: derive kategori/probabilitas/forecast dari stage (selaras STAGE_DERIVE
// importer scripts/db/import_hs_s1.py — SATU sumber kebenaran, jaga tetap sinkron).
const STAGE_META: Record<string, { prospect: string; prob: number; forecast: string }> = {
  "Prospecting":   { prospect: "Cold", prob: 0.1,  forecast: "D - Omit" },
  "First Contact": { prospect: "Cold", prob: 0.2,  forecast: "C - Pipeline" },
  "Presentation":  { prospect: "Cold", prob: 0.5,  forecast: "C - Pipeline" },
  "Quotation":     { prospect: "Cold", prob: 0.4,  forecast: "C - Pipeline" },
  "Offering":      { prospect: "Warm", prob: 0.6,  forecast: "B - Best Case" },
  "Negotiation":   { prospect: "Hot",  prob: 0.85, forecast: "A - Commit" },
  "Closing-Won":   { prospect: "Hot",  prob: 1.0,  forecast: "Won" },
  "Closing-Lost":  { prospect: "",     prob: 0.0,  forecast: "Lost" },
};

// enum deal_loss_reason (migrasi 057) — wajib saat transisi ke Closing-Lost.
export const DEAL_LOSS_REASONS = ["harga", "kompetitor", "no-budget", "kalah-tender", "internal-RS"];

// Error dgn status HTTP eksplisit → endpoint map ke response code yg tepat.
export class DealError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DealError";
  }
}

// Write-guard: boleh ubah deal kalau superuser, ATAU deal miliknya (am_id match),
// ATAU deal di cabang yg dia pegang (HoD via cabangScope). Reuse resolveScope shape.
function canWrite(scope: DataScope, deal: { am_id: string | null; cabang: string | null }): boolean {
  if (scope.superuser) return true;
  if (scope.amId && deal.am_id && deal.am_id === scope.amId) return true;
  if (scope.cabangScope && deal.cabang && scope.cabangScope.includes(deal.cabang)) return true;
  return false;
}

// Read-guard: sejalan dgn filter getPipeline. Scope TAK membatasi (FULL_SCOPE/
// superuser/HoD-tanpa-territory) → boleh baca semua; AM → deal sendiri; HoD → cabang.
function canRead(scope: DataScope, deal: { am_id: string | null; cabang: string | null }): boolean {
  if (!isRestricted(scope)) return true;
  if (scope.amOnly && scope.amId && deal.am_id === scope.amId) return true;
  if (scope.cabangScope && deal.cabang && scope.cabangScope.includes(deal.cabang)) return true;
  return false;
}

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
  scope?: DataScope,
): Promise<{ stages: PipelineStage[]; summary: PipelineSummary; total_deals: number; total_value: number }> {
  const sql = db();
  const cols = sql`deal_id, customer_name, facility_name, am_id, brand, product, product_category,
    prospect_category, stage, probability, forecast_category,
    COALESCE(estimated_value, estimate_amount) AS estimate_amount,
    pic_hod, cabang, coop_model, city, province, purchase_year, notes, updated_at,
    GREATEST(0, EXTRACT(DAY FROM (now() - stage_entered_at))::int) AS days_in_stage`;
  // Row-level scope (pakai semantik isRestricted spt F127): scope TAK membatasi
  // (FULL_SCOPE / superuser/admin / HoD-tanpa-territory / tanpa x-user-id) → lihat
  // SEMUA; AM → deal sendiri; HoD ber-territory → deal di cabang timnya.
  let rows;
  if (!scope || !isRestricted(scope)) {
    rows = await sql`SELECT ${cols} FROM deal ORDER BY updated_at DESC`;
  } else if (scope.amOnly && scope.amId) {
    rows = await sql`SELECT ${cols} FROM deal WHERE am_id = ${scope.amId} ORDER BY updated_at DESC`;
  } else {
    // isRestricted true & bukan amOnly → pasti punya cabangScope (HoD ber-territory).
    rows = await sql`SELECT ${cols} FROM deal WHERE cabang = ANY(${scope.cabangScope!}) ORDER BY updated_at DESC`;
  }

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

export interface TransitionResult {
  deal_id: string;
  from_stage: string;
  stage: string;
  probability: number;
  prospect_category: string;
  forecast_category: string;
  loss_status: string | null;
  state_log_id: string;
}

/**
 * Transisi stage satu deal (drag kanban / aksi manual). Menerapkan:
 *  - write-guard via resolveScope (AM data sendiri, HoD cabang, admin semua),
 *  - validasi stage target ∈ DEAL_STAGES,
 *  - gate Closing-Lost WAJIB loss_reason (∈ enum) → loss_status='pending' (nunggu HoD),
 *  - derive probability/kategori/forecast dari stage (STAGE_META),
 *  - reset stage_entered_at (days_in_stage/stale mulai ulang),
 *  - catat timeline di spt_state_log.
 * Melempar DealError(status) → endpoint map ke 400/403/404.
 */
export async function transitionStage(
  dealId: string,
  toStage: string,
  scope: DataScope,
  opts?: { lossReason?: string; note?: string },
): Promise<TransitionResult> {
  const sql = db();
  if (!DEAL_STAGES.includes(toStage)) {
    throw new DealError(400, `stage tidak valid: ${toStage}`);
  }
  const cur = await sql`SELECT stage, am_id, cabang FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new DealError(404, "deal tidak ditemukan");
  const fromStage = String(cur[0].stage);
  const deal = { am_id: cur[0].am_id ? String(cur[0].am_id) : null, cabang: cur[0].cabang ? String(cur[0].cabang) : null };
  if (!canWrite(scope, deal)) throw new DealError(403, "tidak berwenang mengubah deal ini");

  const meta = STAGE_META[toStage];
  const toLost = toStage === "Closing-Lost";
  let lossReason: string | null = null;
  let lossStatus: string | null = null;
  if (toLost) {
    lossReason = (opts?.lossReason ?? "").trim();
    if (!DEAL_LOSS_REASONS.includes(lossReason)) {
      throw new DealError(400, `Closing-Lost wajib loss_reason (${DEAL_LOSS_REASONS.join(", ")})`);
    }
    lossStatus = "pending"; // nunggu approval HoD
  }

  // Update deal: stage + derive + reset stage_entered_at. Pindah KELUAR dari Lost → bersihin loss fields.
  await sql`
    UPDATE deal SET
      stage = ${toStage},
      prospect_category = ${meta.prospect || null},
      probability = ${meta.prob},
      forecast_category = ${meta.forecast},
      loss_reason = ${lossReason}::deal_loss_reason,
      loss_status = ${lossStatus},
      stage_entered_at = now(),
      updated_at = now()
    WHERE deal_id = ${dealId}
  `;
  const reason = toLost
    ? `stage ${fromStage}→${toStage} | loss: ${lossReason}${opts?.note ? ` | ${opts.note}` : ""}`
    : `stage ${fromStage}→${toStage}${opts?.note ? ` | ${opts.note}` : ""}`;
  const logged = await sql`
    INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
    VALUES (${dealId}, ${fromStage}, ${toStage}, ${scope.userId ?? scope.amId}, ${reason})
    RETURNING id
  `;
  return {
    deal_id: dealId,
    from_stage: fromStage,
    stage: toStage,
    probability: meta.prob,
    prospect_category: meta.prospect,
    forecast_category: meta.forecast,
    loss_status: lossStatus,
    state_log_id: String(logged[0].id),
  };
}

// Approve-guard: HANYA HoD (cabang deal ∈ cabangScope) atau admin/superuser boleh
// memutus loss. AM (amOnly) TIDAK boleh — pemisahan tugas (bukan penilai loss deal
// sendiri). Beda dari canWrite (yg izinkan AM utk deal-nya).
function canApprove(scope: DataScope, deal: { cabang: string | null }): boolean {
  if (scope.superuser) return true;
  if (scope.amOnly) return false;
  if (scope.cabangScope && deal.cabang && scope.cabangScope.includes(deal.cabang)) return true;
  return false;
}

export interface LossPending {
  deal_id: string;
  customer_name: string;
  facility_name: string | null;
  am_id: string | null;
  brand: string | null;
  product: string | null;
  cabang: string | null;
  estimate_amount: number | null;
  loss_reason: string | null;
  requested_at: string;      // occurred_at transisi masuk Closing-Lost terakhir
  requested_by: string | null;
  requested_note: string | null;
  revert_stage: string;      // stage sebelum Lost (target kalau di-reject)
}

/**
 * Daftar deal loss_status='pending' yg boleh diputus user ini (HoD cabangnya /
 * admin semua; AM → kosong). Ikutkan revert_stage (from_stage transisi masuk Lost
 * terakhir) + konteks request (kapan/siapa/alasan) utk panel approval.
 */
export async function listPendingLosses(scope: DataScope): Promise<LossPending[]> {
  const sql = db();
  // AM tak berhak approve apa pun → kembalikan kosong tanpa query.
  if (!scope.superuser && scope.amOnly) return [];
  const cabangFilter =
    !scope.superuser && scope.cabangScope && scope.cabangScope.length > 0
      ? sql`AND d.cabang = ANY(${scope.cabangScope})`
      : sql``;
  const rows = await sql`
    SELECT d.deal_id, d.customer_name, d.facility_name, d.am_id, d.brand, d.product, d.cabang,
      COALESCE(d.estimated_value, d.estimate_amount) AS estimate_amount, d.loss_reason,
      l.occurred_at AS requested_at, l.changed_by AS requested_by, l.reason AS requested_reason,
      l.from_stage AS revert_stage
    FROM deal d
    LEFT JOIN LATERAL (
      SELECT occurred_at, changed_by, reason, from_stage
      FROM spt_state_log
      WHERE deal_id = d.deal_id AND to_stage = 'Closing-Lost'
      ORDER BY occurred_at DESC LIMIT 1
    ) l ON true
    WHERE d.stage = 'Closing-Lost' AND d.loss_status = 'pending'
    ${cabangFilter}
    ORDER BY l.occurred_at DESC NULLS LAST
  `;
  return rows.map((r) => {
    const rev = r.revert_stage ? String(r.revert_stage) : "";
    return {
      deal_id: String(r.deal_id),
      customer_name: String(r.customer_name ?? ""),
      facility_name: r.facility_name ? String(r.facility_name) : null,
      am_id: r.am_id ? String(r.am_id) : null,
      brand: r.brand ? String(r.brand) : null,
      product: r.product ? String(r.product) : null,
      cabang: r.cabang ? String(r.cabang) : null,
      estimate_amount: r.estimate_amount != null ? Number(r.estimate_amount) : null,
      loss_reason: r.loss_reason ? String(r.loss_reason) : null,
      requested_at: r.requested_at ? String(r.requested_at) : "",
      requested_by: r.requested_by ? String(r.requested_by) : null,
      requested_note: r.requested_reason ? String(r.requested_reason) : null,
      // Kalau from_stage kosong/terminal (data lama) → default Negotiation (stage wajar sebelum Lost).
      revert_stage: rev && DEAL_STAGES.includes(rev) && !CLOSED.includes(rev) ? rev : "Negotiation",
    };
  });
}

export interface LossDecisionResult {
  deal_id: string;
  decision: "approved" | "rejected";
  stage: string;          // Closing-Lost (approve) / revert_stage (reject)
  loss_status: string | null;
  state_log_id: string;
}

/**
 * Putuskan loss pending (HoD/admin). approve → loss_status='approved', tetap Closing-Lost.
 * reject → deal BALIK ke stage sebelum Lost (from_stage transisi masuk Lost), loss_reason
 * & loss_status dibersihkan, derive prob/kategori/forecast dari stage baru, reset
 * stage_entered_at. Kedua keputusan dicatat di spt_state_log. Guard canApprove (AM ditolak).
 */
export async function decideLoss(
  dealId: string,
  decision: "approved" | "rejected",
  scope: DataScope,
  note?: string,
): Promise<LossDecisionResult> {
  const sql = db();
  if (decision !== "approved" && decision !== "rejected") throw new DealError(400, "decision harus approved/rejected");
  const cur = await sql`SELECT stage, cabang, loss_status FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new DealError(404, "deal tidak ditemukan");
  const deal = { cabang: cur[0].cabang ? String(cur[0].cabang) : null };
  if (!canApprove(scope, deal)) throw new DealError(403, "hanya HoD/admin yang boleh memutus loss");
  if (String(cur[0].stage) !== "Closing-Lost" || String(cur[0].loss_status ?? "") !== "pending") {
    throw new DealError(409, "deal tidak dalam status loss pending");
  }
  const by = scope.userId ?? scope.amId;

  if (decision === "approved") {
    await sql`UPDATE deal SET loss_status = 'approved', updated_at = now() WHERE deal_id = ${dealId}`;
    const logged = await sql`
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      VALUES (${dealId}, 'Closing-Lost', 'Closing-Lost', ${by}, ${`loss approved${note ? ` | ${note}` : ""}`})
      RETURNING id
    `;
    return { deal_id: dealId, decision, stage: "Closing-Lost", loss_status: "approved", state_log_id: String(logged[0].id) };
  }

  // reject → cari from_stage transisi masuk Lost terakhir, revert ke situ.
  const prev = await sql`
    SELECT from_stage FROM spt_state_log
    WHERE deal_id = ${dealId} AND to_stage = 'Closing-Lost'
    ORDER BY occurred_at DESC LIMIT 1
  `;
  const rev = prev.length > 0 && prev[0].from_stage ? String(prev[0].from_stage) : "";
  const revertStage = rev && DEAL_STAGES.includes(rev) && !CLOSED.includes(rev) ? rev : "Negotiation";
  const meta = STAGE_META[revertStage];
  await sql`
    UPDATE deal SET
      stage = ${revertStage},
      prospect_category = ${meta.prospect || null},
      probability = ${meta.prob},
      forecast_category = ${meta.forecast},
      loss_reason = NULL,
      loss_status = NULL,
      stage_entered_at = now(),
      updated_at = now()
    WHERE deal_id = ${dealId}
  `;
  const logged = await sql`
    INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
    VALUES (${dealId}, 'Closing-Lost', ${revertStage}, ${by}, ${`loss rejected → balik ${revertStage}${note ? ` | ${note}` : ""}`})
    RETURNING id
  `;
  return { deal_id: dealId, decision, stage: revertStage, loss_status: null, state_log_id: String(logged[0].id) };
}

export interface TimelineEntry {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  reason: string | null;
  occurred_at: string;
}

/**
 * Riwayat spt_state_log satu deal (perpindahan stage + approval/reject Lost),
 * terbaru dulu. Guard baca (canRead) sejalan dgn akses board — deal yg tak boleh
 * dilihat user → 403.
 */
export async function getDealTimeline(dealId: string, scope: DataScope): Promise<TimelineEntry[]> {
  const sql = db();
  const cur = await sql`SELECT am_id, cabang FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new DealError(404, "deal tidak ditemukan");
  const deal = { am_id: cur[0].am_id ? String(cur[0].am_id) : null, cabang: cur[0].cabang ? String(cur[0].cabang) : null };
  if (!canRead(scope, deal)) throw new DealError(403, "tidak berwenang melihat deal ini");
  const rows = await sql`
    SELECT id, from_stage, to_stage, changed_by, reason, occurred_at
    FROM spt_state_log
    WHERE deal_id = ${dealId}
    ORDER BY occurred_at DESC, id DESC
  `;
  return rows.map((r) => ({
    id: String(r.id),
    from_stage: r.from_stage ? String(r.from_stage) : null,
    to_stage: String(r.to_stage),
    changed_by: r.changed_by ? String(r.changed_by) : null,
    reason: r.reason ? String(r.reason) : null,
    occurred_at: String(r.occurred_at),
  }));
}

// Field deal yg boleh di-set user via form create/edit (whitelist — cegah user
// nyetel stage/loss/am_id/probability langsung; itu lewat jalur khusus).
const DEAL_EDITABLE = [
  "customer_name", "facility_name", "brand", "product", "product_category",
  "estimate_amount", "cabang", "coop_model", "city", "province", "purchase_year",
  "pic_hod", "notes",
] as const;

const PRODUCT_CATEGORIES = ["IVD", "Medical"];

// Ambil hanya field whitelist dari input; "" → null; angka di-cast.
function pickEditable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DEAL_EDITABLE) {
    if (input[k] === undefined) continue;
    let v: unknown = input[k];
    if (v === "") v = null;
    if ((k === "estimate_amount" || k === "purchase_year") && v != null) {
      const n = Number(v);
      v = Number.isFinite(n) ? n : null;
    }
    out[k] = v;
  }
  return out;
}

export interface DealMutationResult {
  deal_id: string;
  stage: string;
}

/**
 * Buat deal baru. AM → am_id dipaksa ke dirinya; HoD/admin boleh set am_id (opsional).
 * Stage awal 'Prospecting' (derive prob/kategori/forecast), catat spt_state_log.
 */
export async function createDeal(scope: DataScope, input: Record<string, unknown>): Promise<DealMutationResult> {
  const sql = db();
  const fields = pickEditable(input);
  const name = (fields.customer_name ?? fields.facility_name) as string | null;
  if (!name || !String(name).trim()) throw new DealError(400, "customer_name atau facility_name wajib diisi");
  if (fields.product_category && !PRODUCT_CATEGORIES.includes(String(fields.product_category))) {
    throw new DealError(400, "product_category harus IVD atau Medical");
  }
  fields.customer_name = String(name).trim();
  fields.customer_id = custId(String(name));
  // AM cuma boleh bikin deal atas namanya sendiri; HoD/admin boleh tunjuk am_id.
  fields.am_id = scope.amOnly ? scope.amId : (typeof input.am_id === "string" && input.am_id ? input.am_id : null);
  const meta = STAGE_META["Prospecting"];
  fields.prospect_category = meta.prospect || null;
  fields.probability = meta.prob;
  fields.forecast_category = meta.forecast;
  // stage sengaja tak di-set → pakai default kolom 'Prospecting'.
  const rows = await sql`INSERT INTO deal ${sql(fields)} RETURNING deal_id, stage`;
  const dealId = String(rows[0].deal_id);
  await sql`
    INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
    VALUES (${dealId}, NULL, 'Prospecting', ${scope.userId ?? scope.amId}, 'deal dibuat')
  `;
  return { deal_id: dealId, stage: String(rows[0].stage) };
}

/**
 * Edit field deal (whitelist). Write-guard canWrite (AM deal sendiri / HoD cabang /
 * admin). TIDAK menyentuh stage/loss (jalur khusus).
 */
export async function updateDeal(dealId: string, scope: DataScope, input: Record<string, unknown>): Promise<DealMutationResult> {
  const sql = db();
  const cur = await sql`SELECT stage, am_id, cabang FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new DealError(404, "deal tidak ditemukan");
  const deal = { am_id: cur[0].am_id ? String(cur[0].am_id) : null, cabang: cur[0].cabang ? String(cur[0].cabang) : null };
  if (!canWrite(scope, deal)) throw new DealError(403, "tidak berwenang mengubah deal ini");
  const fields = pickEditable(input);
  if (Object.keys(fields).length === 0) throw new DealError(400, "tidak ada field untuk diupdate");
  if (fields.product_category && !PRODUCT_CATEGORIES.includes(String(fields.product_category))) {
    throw new DealError(400, "product_category harus IVD atau Medical");
  }
  if (fields.customer_name != null) fields.customer_id = custId(String(fields.customer_name));
  await sql`UPDATE deal SET ${sql(fields)}, updated_at = now() WHERE deal_id = ${dealId}`;
  return { deal_id: dealId, stage: String(cur[0].stage) };
}

/**
 * Hapus deal (+ riwayat spt_state_log-nya) dalam transaksi. Destruktif → hanya
 * admin/superuser.
 */
export async function deleteDeal(dealId: string, scope: DataScope): Promise<{ deleted: string }> {
  if (!scope.superuser) throw new DealError(403, "hanya admin yang boleh menghapus deal");
  const sql = db();
  const cur = await sql`SELECT deal_id FROM deal WHERE deal_id = ${dealId}`;
  if (cur.length === 0) throw new DealError(404, "deal tidak ditemukan");
  await sql.begin(async (tx) => {
    await tx`DELETE FROM spt_state_log WHERE deal_id = ${dealId}`;
    await tx`DELETE FROM deal WHERE deal_id = ${dealId}`;
  });
  return { deleted: dealId };
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
