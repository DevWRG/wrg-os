import { createHash } from "node:crypto";

import { db } from "../db.js";

// A2 — AR Aging Watch (Blueprint v2.3, R1/L2). Baca ar_aging_mv, prioritaskan
// piutang berisiko, log run ke audit_log (Layer 4 Output) + update registry.

const SEVERITY: Record<string, number> = {
  current: 0,
  "1-30": 1,
  "31-60": 2,
  "61-90": 3,
  "90+": 4,
};

export interface ArFinding {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  severity: number;
  critical: boolean;
}

export async function runArWatch(): Promise<{
  agent_id: string;
  audit_id: string;
  summary: {
    overdue_invoices: number;
    overdue_amount: number;
    critical_count: number;
    by_bucket: Record<string, number>;
  };
  top_findings: ArFinding[];
}> {
  const sql = db();
  const rows = await sql`
    SELECT customer_id, customer_name, invoice_no, amount, days_overdue, bucket, is_anomaly
    FROM ar_aging_mv
    WHERE days_overdue > 0
    ORDER BY days_overdue DESC, amount DESC
  `;

  const findings: ArFinding[] = rows.map((r) => ({
    customer_id: String(r.customer_id),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    invoice_no: String(r.invoice_no),
    amount: Number(r.amount),
    days_overdue: Number(r.days_overdue),
    bucket: String(r.bucket),
    severity: SEVERITY[String(r.bucket)] ?? 0,
    critical: String(r.bucket) === "90+" || Boolean(r.is_anomaly),
  }));

  const byBucket: Record<string, number> = {};
  for (const f of findings) byBucket[f.bucket] = (byBucket[f.bucket] ?? 0) + 1;
  const critical = findings.filter((f) => f.critical);
  const summary = {
    overdue_invoices: findings.length,
    overdue_amount: findings.reduce((a, f) => a + f.amount, 0),
    critical_count: critical.length,
    by_bucket: byBucket,
  };
  const top = critical.slice(0, 10);

  const inputHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const outputHash = createHash("sha256")
    .update(JSON.stringify({ summary, top }))
    .digest("hex");
  const payload = { summary, top_findings: top };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D2', ${`a2-${inputHash.slice(0, 8)}`}, 'A2', 4, 'ar.watch.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A2'`;

  return { agent_id: "A2", audit_id: a.id as string, summary, top_findings: top };
}
