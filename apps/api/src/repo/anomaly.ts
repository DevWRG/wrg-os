import { db } from "../db.js";

// Cross-domain — sumber data deteksi anomali numerik (A5). Outlier dihitung
// dengan statistik robust (median + MAD → modified z-score Iglewicz-Hoaglin),
// tahan terhadap nilai ekstrem itu sendiri (beda dari mean/std).

export interface SeriesPoint {
  entity_id: string;
  label: string | null;
  value: number;
}

// Nilai estimasi deal terbuka (non-Lose) — outlier bisa berarti salah input
// atau sandbagging.
export async function getDealValueSeries(): Promise<SeriesPoint[]> {
  const sql = db();
  const rows = await sql`
    SELECT deal_id, customer_name, estimated_value
    FROM deal
    WHERE estimated_value IS NOT NULL AND stage <> 'Lose'
  `;
  return rows.map((r) => ({
    entity_id: String(r.deal_id),
    label: r.customer_name ? String(r.customer_name) : null,
    value: Number(r.estimated_value),
  }));
}

// Nominal invoice AR — outlier bisa berarti tagihan ganda / salah angka.
export async function getArAmountSeries(): Promise<SeriesPoint[]> {
  const sql = db();
  const rows = await sql`
    SELECT customer_id, customer_name, invoice_no, amount
    FROM ar_aging_mv
    WHERE amount IS NOT NULL
  `;
  return rows.map((r) => ({
    entity_id: `${String(r.customer_id)}:${String(r.invoice_no)}`,
    label: r.customer_name ? String(r.customer_name) : String(r.customer_id),
    value: Number(r.amount),
  }));
}

// Eskalasi L3 ke hitl_queue (idempoten per stream+entity). agent_id='A5'.
export async function enqueueAnomalyFlag(finding: {
  stream: string;
  entity_id: string;
  label: string | null;
  value: number;
  score: number;
  direction: string;
  median: number;
}): Promise<string | null> {
  const sql = db();
  const corr = `a5-${finding.stream}-${finding.entity_id}`;
  const existing = await sql`
    SELECT 1 FROM hitl_queue WHERE correlation_id = ${corr} AND status = 'pending' LIMIT 1
  `;
  if (existing.length > 0) return null;
  const payload = { type: "anomaly_flag", ...finding };
  const rows = await sql`
    INSERT INTO hitl_queue (correlation_id, agent_id, r_tier, hitl_level, payload)
    VALUES (${corr}, 'A5', 'R2', 'L3', ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return rows[0].id as string;
}

// ── Statistik robust ──
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median Absolute Deviation.
export function mad(xs: number[], med: number): number {
  return median(xs.map((x) => Math.abs(x - med)));
}
