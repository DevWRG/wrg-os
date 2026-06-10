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
  await upsertAging(invoices, asof);

  // Catat ingest sebagai event Accurate (audit feeder).
  const hash = createHash("sha256").update(JSON.stringify(invoices)).digest("hex");
  const [wh] = await sql`
    INSERT INTO accurate_webhook_log (event_type, payload, input_hash, processed)
    VALUES ('ar.invoices.ingest', ${sql.json(invoices as unknown as Parameters<typeof sql.json>[0])}, ${hash}, true)
    RETURNING id
  `;
  return { ingested: invoices.length, webhook_id: wh.id as string };
}

// Upsert state aging (idempoten by customer_id+invoice_no). Tanpa logging.
async function upsertAging(invoices: InvoiceInput[], asof?: string): Promise<void> {
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
}

// ── Accurate webhook adapter ──
// Objek invoice Accurate (envelope .d / REST). Lihat legacy/crm sync_accurate.sh.
export interface AccurateInvoice {
  id?: number | string;
  number?: string;
  transNumber?: string;
  customerId?: number | string;
  customer?: { id?: number | string; name?: string };
  retailWpName?: string;
  dueDate?: string;
  transDate?: string;
  totalDue?: number | string;
  totalAmount?: number | string;
}

// Accurate pakai dd/MM/yyyy; normalisasi ke yyyy-MM-dd. Toleran ISO & dd-MM-yyyy.
export function normalizeAccurateDate(s?: string): string | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

export function mapAccurateInvoice(rec: AccurateInvoice): InvoiceInput | null {
  const invoiceNo = String(rec.number ?? rec.transNumber ?? rec.id ?? "").trim();
  const customerId = String(rec.customerId ?? rec.customer?.id ?? "").trim();
  const dueDate = normalizeAccurateDate(rec.dueDate ?? rec.transDate);
  if (!invoiceNo || !customerId || !dueDate) return null;
  const amount = Number(rec.totalDue ?? rec.totalAmount ?? 0) || 0;
  return {
    customer_id: customerId,
    customer_name: rec.customer?.name ?? rec.retailWpName ?? undefined,
    invoice_no: invoiceNo,
    due_date: dueDate,
    amount,
  };
}

// Ingest payload webhook Accurate → ar_aging_mv (upsert idempoten) + log raw.
export async function ingestAccurateWebhook(
  records: AccurateInvoice[],
  asof?: string,
): Promise<{ ingested: number; skipped: number; webhook_id: string }> {
  const sql = db();
  const mapped: InvoiceInput[] = [];
  let skipped = 0;
  for (const rec of records) {
    const m = mapAccurateInvoice(rec);
    if (m) mapped.push(m);
    else skipped += 1;
  }
  if (mapped.length > 0) await upsertAging(mapped, asof);

  const hash = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  const [wh] = await sql`
    INSERT INTO accurate_webhook_log (event_type, payload, input_hash, processed)
    VALUES ('accurate.webhook', ${sql.json(records as unknown as Parameters<typeof sql.json>[0])}, ${hash}, ${mapped.length > 0})
    RETURNING id
  `;
  return { ingested: mapped.length, skipped, webhook_id: wh.id as string };
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
