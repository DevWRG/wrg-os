import { createHash } from "node:crypto";

import { db } from "../db.js";

// D2 AR Aging — feeder (ingest invoice Accurate → ar_aging_mv) + read model.
// Bucket dihitung dari days_overdue relatif `asof` (default hari ini).

export interface InvoiceInput {
  customer_id: string;
  customer_name?: string;
  invoice_no: string;
  due_date: string; // YYYY-MM-DD
  amount: number;
}

function bucketOf(days: number): string {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function ingestInvoices(
  invoices: InvoiceInput[],
  asof?: string,
): Promise<{ ingested: number; webhook_id: string }> {
  const sql = db();
  const base =
    asof && /^\d{4}-\d{2}-\d{2}$/.test(asof) ? new Date(`${asof}T00:00:00Z`) : new Date();

  for (const inv of invoices) {
    const due = new Date(`${inv.due_date}T00:00:00Z`);
    const days = Math.floor((base.getTime() - due.getTime()) / 86_400_000);
    const overdue = Math.max(0, days);
    const bucket = bucketOf(days);
    const isAnomaly = bucket === "90+";
    await sql`
      INSERT INTO ar_aging_mv
        (customer_id, customer_name, invoice_no, due_date, amount, days_overdue, bucket, is_anomaly, refreshed_at)
      VALUES
        (${inv.customer_id}, ${inv.customer_name ?? null}, ${inv.invoice_no}, ${inv.due_date},
         ${inv.amount}, ${overdue}, ${bucket}, ${isAnomaly}, now())
      ON CONFLICT (customer_id, invoice_no) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        due_date      = EXCLUDED.due_date,
        amount        = EXCLUDED.amount,
        days_overdue  = EXCLUDED.days_overdue,
        bucket        = EXCLUDED.bucket,
        is_anomaly    = EXCLUDED.is_anomaly,
        refreshed_at  = now()
    `;
  }

  // Catat ingest sebagai event Accurate (audit feeder).
  const hash = createHash("sha256").update(JSON.stringify(invoices)).digest("hex");
  const [wh] = await sql`
    INSERT INTO accurate_webhook_log (event_type, payload, input_hash, processed)
    VALUES ('ar.invoices.ingest', ${sql.json(invoices as unknown as Parameters<typeof sql.json>[0])}, ${hash}, true)
    RETURNING id
  `;
  return { ingested: invoices.length, webhook_id: wh.id as string };
}

export interface AgingInvoice {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  due_date: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  is_anomaly: boolean;
}

export async function getAging(bucket?: string): Promise<{
  total_outstanding: number;
  total_invoices: number;
  buckets: { bucket: string; count: number; total: number }[];
  invoices: AgingInvoice[];
}> {
  const sql = db();
  const cols = sql`customer_id, customer_name, invoice_no, due_date::text, amount, days_overdue, bucket, is_anomaly`;
  const rows = bucket
    ? await sql`SELECT ${cols} FROM ar_aging_mv WHERE bucket = ${bucket} ORDER BY days_overdue DESC`
    : await sql`SELECT ${cols} FROM ar_aging_mv ORDER BY days_overdue DESC`;
  const summary = await sql`SELECT bucket, count(*) AS count, COALESCE(sum(amount),0) AS total FROM ar_aging_mv GROUP BY bucket`;
  const [tot] = await sql`SELECT COALESCE(sum(amount),0) AS total, count(*) AS count FROM ar_aging_mv`;

  return {
    total_outstanding: Number(tot.total),
    total_invoices: Number(tot.count),
    buckets: summary.map((r) => ({
      bucket: String(r.bucket),
      count: Number(r.count),
      total: Number(r.total),
    })),
    invoices: rows.map((r) => ({
      customer_id: String(r.customer_id),
      customer_name: r.customer_name ? String(r.customer_name) : null,
      invoice_no: String(r.invoice_no),
      due_date: String(r.due_date),
      amount: Number(r.amount),
      days_overdue: Number(r.days_overdue),
      bucket: String(r.bucket),
      is_anomaly: Boolean(r.is_anomaly),
    })),
  };
}
