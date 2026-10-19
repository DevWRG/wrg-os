import { db } from "../db.js";

// D1 — sumber audit keaslian pipeline (A4). Baca deal + riwayat transisi
// (spt_state_log) untuk mendeteksi pola yang mencurigakan: stage maju tanpa
// jejak #REPORT, deal mangkrak, lompat-stage, dan menang implausibel cepat.

// Jalur maju kanonik = 7 tahap SPT (migrasi 069, DEAL_STAGES di repo/deal.ts) tanpa
// 'Closing-Lost' yang merupakan terminal-kalah, bukan kemajuan.
export const ADV_ORDER = [
  "Prospecting",
  "Presentation",
  "Quotation",
  "Negotiation",
  "Closing",
  "Closing-Won",
];

// Nama tahap lama (sebelum migrasi 057/069) masih bisa muncul di spt_state_log
// yang tercatat dulu. Dipetakan sama seperti migrasinya supaya riwayat lama
// tetap terbaca.
const LEGACY_STAGE: Record<string, string> = {
  "cold": "Prospecting",
  "follow up": "Prospecting",
  "first contact": "Prospecting",
  "sph": "Quotation",
  "offering letter": "Quotation",
  "offering": "Quotation",
  "presentasi": "Presentation",
  "negotiating": "Negotiation",
  "negosiasi": "Negotiation",
  "proses di manajemen": "Negotiation",
  "deal": "Closing-Won",
  "mou": "Closing-Won",
  "won": "Closing-Won",
  "lose": "Closing-Lost",
  "gagal": "Closing-Lost",
};

export function canonStage(stage: string): string {
  return LEGACY_STAGE[stage.trim().toLowerCase()] ?? stage;
}

export function advIdx(stage: string): number {
  return ADV_ORDER.indexOf(canonStage(stage));
}

export function isWonStage(stage: string): boolean {
  return canonStage(stage) === "Closing-Won";
}

export interface DealRow {
  deal_id: string;
  customer_name: string | null;
  am_id: string;
  stage: string;
  estimated_value: number | null;
  created_ms: number;
  log_count: number;
  days_idle: number;
}

export interface TransitionRow {
  deal_id: string;
  from_stage: string | null;
  to_stage: string;
  ts_ms: number;
}

// Semua deal non-Lost + agregat aktivitas (jumlah transisi & hari mangkrak).
export async function getDealsForAudit(): Promise<DealRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT d.deal_id, d.customer_name, d.am_id, d.stage, d.estimated_value,
           (extract(epoch FROM d.created_at) * 1000)::bigint AS created_ms,
           count(s.id)::int AS log_count,
           (extract(epoch FROM now() - greatest(
              d.updated_at, coalesce(max(s.occurred_at), d.updated_at)
            )) / 86400)::float AS days_idle
    FROM deal d
    LEFT JOIN spt_state_log s ON s.deal_id = d.deal_id
    WHERE d.stage::text <> 'Closing-Lost'
    GROUP BY d.deal_id
  `;
  return rows.map((r) => ({
    deal_id: String(r.deal_id),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    am_id: String(r.am_id),
    stage: String(r.stage),
    estimated_value: r.estimated_value === null ? null : Number(r.estimated_value),
    created_ms: Number(r.created_ms),
    log_count: Number(r.log_count),
    days_idle: Number(r.days_idle),
  }));
}

// Riwayat transisi semua deal non-Lost, urut waktu (di-group di pemanggil).
export async function getDealTransitions(): Promise<TransitionRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT s.deal_id, s.from_stage, s.to_stage,
           (extract(epoch FROM s.occurred_at) * 1000)::bigint AS ts_ms
    FROM spt_state_log s
    JOIN deal d ON d.deal_id = s.deal_id
    WHERE d.stage::text <> 'Closing-Lost'
    ORDER BY s.occurred_at ASC
  `;
  return rows.map((r) => ({
    deal_id: String(r.deal_id),
    from_stage: r.from_stage ? String(r.from_stage) : null,
    to_stage: String(r.to_stage),
    ts_ms: Number(r.ts_ms),
  }));
}

// Eskalasi L3 ke hitl_queue (idempoten: lewati bila sudah ada baris pending
// untuk deal yang sama). agent_id='A4', hitl_level='L3'.
export async function enqueuePipelineFlag(finding: {
  deal_id: string;
  customer_name: string | null;
  am_id: string;
  stage: string;
  estimated_value: number | null;
  flags: string[];
  score: number;
}): Promise<string | null> {
  const sql = db();
  const corr = `a4-${finding.deal_id}`;
  const existing = await sql`
    SELECT 1 FROM hitl_queue WHERE correlation_id = ${corr} AND status = 'pending' LIMIT 1
  `;
  if (existing.length > 0) return null;
  const payload = { type: "pipeline_authenticity_flag", ...finding };
  const rows = await sql`
    INSERT INTO hitl_queue (correlation_id, agent_id, r_tier, hitl_level, payload)
    VALUES (${corr}, 'A4', 'R2', 'L3', ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return rows[0].id as string;
}
