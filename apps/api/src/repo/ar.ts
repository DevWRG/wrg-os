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
  primeOwing?: number | string;
  taxOwing?: number | string;
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
  // amount = SISA tagihan (net). Payload detail Accurate tak isi totalDue → dulu
  // fallback ke totalAmount (gross) → MV overstated. Sumber benar = primeOwing+taxOwing.
  const amount = (Number(rec.primeOwing) || 0) + (Number(rec.taxOwing) || 0);
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
  // Buang invoice yg TERKONFIRMASI lunas di mirror (outstanding=0); amount =
  // outstanding hidup bila cocok (partial-paid ikut sisanya), else fallback
  // ar_aging_mv.amount agar baris tak-cocok tak hilang. due_date/bucket dari ar_aging_mv.
  const rows = await sql`
    SELECT m.customer_id, m.customer_name, m.invoice_no, m.due_date::text AS due_date,
      COALESCE(ai.outstanding, m.amount)::float8 AS amount, m.days_overdue, m.bucket, m.is_anomaly
    FROM ar_aging_mv m
    LEFT JOIN accurate_invoice ai ON ai.number = m.invoice_no AND ai.customer_id::text = m.customer_id
    WHERE COALESCE(ai.outstanding, m.amount) > 0
    ORDER BY m.days_overdue DESC`;
  const bmap = new Map<string, { count: number; total: number }>();
  let totAmt = 0;
  for (const r of rows) {
    totAmt += Number(r.amount);
    const b = bmap.get(String(r.bucket)) ?? { count: 0, total: 0 };
    b.count += 1; b.total += Number(r.amount);
    bmap.set(String(r.bucket), b);
  }
  const shown = bucket ? rows.filter((r) => String(r.bucket) === bucket) : rows;

  return {
    total_outstanding: totAmt,
    total_invoices: rows.length,
    buckets: [...bmap.entries()].map(([b, v]) => ({ bucket: b, count: v.count, total: v.total })),
    invoices: shown.map((r) => ({
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

// F30 AR Aging per Customer — agregasi ar_aging_mv per customer + breakdown 5 bucket
// umur + prioritas tagih + resolve AM/cabang (invoice terakhir, dari accurate_invoice).
// Read-only utk drill-down UI (bucket = konvensi existing: current/1-30/31-60/61-90/90+).
export type ArPriority = "KRITIS" | "TINGGI" | "SEDANG" | "RENDAH";
// Prioritas tagih dari bucket tertua yg punya nominal: 90+ → KRITIS, dst.
function arPriorityOf(b31_60: number, b61_90: number, b90plus: number): ArPriority {
  if (b90plus > 0) return "KRITIS";
  if (b61_90 > 0) return "TINGGI";
  if (b31_60 > 0) return "SEDANG";
  return "RENDAH";
}
// Detail satu invoice (header + line item) dari mirror Accurate, di-lookup by
// nomor invoice (ar_aging_mv.invoice_no = accurate_invoice.number). Read-only.
export async function invoiceDetail(no: string) {
  const sql = db();
  const [inv] = await sql`
    SELECT ai.id, ai.number,
      COALESCE(NULLIF(ac.name,''), NULLIF(ai.raw->'customer'->>'name',''), NULLIF(ai.raw->>'retailWpName',''), 'Customer #'||ai.customer_id::text) AS customer_name,
      ai.tanggal::text AS tanggal, ai.total::float8 AS total, ai.taxable_amount::float8 AS taxable,
      ai.tax_amount::float8 AS tax, ai.paid::float8 AS paid, ai.outstanding::float8 AS outstanding,
      ai.status, COALESCE(NULLIF(mu.nama,''), NULLIF(ai.salesman_name,'')) AS am, NULLIF(mu.cabang,'') AS cabang
    FROM accurate_invoice ai
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.number = ${no}
    LIMIT 1`;
  if (!inv) return { ok: false as const, invoice: null, items: [] };
  const items = await sql`
    SELECT aii.line_no,
      COALESCE(NULLIF(it.name,''), NULLIF(aii.raw->>'detailName',''), 'Item #'||aii.item_id::text) AS name,
      aii.qty::float8 AS qty, aii.unit, aii.unit_price::float8 AS unit_price,
      aii.discount_amount::float8 AS discount, aii.total::float8 AS total
    FROM accurate_invoice_item aii
    LEFT JOIN accurate_item it ON it.id = aii.item_id
    WHERE aii.invoice_id = ${inv.id}
    ORDER BY aii.line_no NULLS LAST, aii.id`;
  return {
    ok: true as const,
    invoice: {
      number: String(inv.number),
      customer_name: String(inv.customer_name),
      tanggal: inv.tanggal ? String(inv.tanggal) : null,
      total: Number(inv.total), taxable: Number(inv.taxable), tax: Number(inv.tax),
      paid: Number(inv.paid), outstanding: Number(inv.outstanding),
      status: inv.status ? String(inv.status) : null,
      am: inv.am ? String(inv.am) : null, cabang: inv.cabang ? String(inv.cabang) : null,
    },
    items: items.map((r) => ({
      line_no: r.line_no == null ? null : Number(r.line_no),
      name: String(r.name), qty: r.qty == null ? null : Number(r.qty), unit: r.unit ? String(r.unit) : null,
      unit_price: Number(r.unit_price), discount: Number(r.discount), total: Number(r.total),
    })),
  };
}

export async function arAgingByCustomer() {
  const sql = db();
  const rows = await sql`
    WITH src AS (
      -- buang hanya invoice yg TERKONFIRMASI lunas di mirror (outstanding=0); baris tak
      -- cocok di mirror tetap dihitung (fallback ar_aging_mv.amount) agar tak hilang.
      SELECT m.customer_id, m.bucket, m.days_overdue, m.customer_name,
        COALESCE(ai.outstanding, m.amount)::float8 AS amount
      FROM ar_aging_mv m
      LEFT JOIN accurate_invoice ai ON ai.number = m.invoice_no AND ai.customer_id::text = m.customer_id
      WHERE COALESCE(ai.outstanding, m.amount) > 0
    ),
    agg AS (
      SELECT s.customer_id AS cid,
        max(s.customer_name) AS name,
        count(*)::int AS invoices,
        COALESCE(sum(s.amount),0)::float8 AS total,
        COALESCE(sum(s.amount) FILTER (WHERE s.bucket = 'current'),0)::float8 AS b_current,
        COALESCE(sum(s.amount) FILTER (WHERE s.bucket = '1-30'),0)::float8 AS b_1_30,
        COALESCE(sum(s.amount) FILTER (WHERE s.bucket = '31-60'),0)::float8 AS b_31_60,
        COALESCE(sum(s.amount) FILTER (WHERE s.bucket = '61-90'),0)::float8 AS b_61_90,
        COALESCE(sum(s.amount) FILTER (WHERE s.bucket = '90+'),0)::float8 AS b_90plus,
        max(s.days_overdue)::int AS max_overdue
      FROM src s
      GROUP BY s.customer_id
    ),
    last_am AS (
      SELECT DISTINCT ON (ai.customer_id::text) ai.customer_id::text AS cid,
        COALESCE(NULLIF(mu.nama,''), NULLIF(ai.salesman_name,'')) AS am,
        NULLIF(mu.cabang,'') AS cabang
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.customer_id IS NOT NULL
      ORDER BY ai.customer_id::text, ai.tanggal DESC
    )
    SELECT a.cid, a.name, a.invoices, a.total, a.b_current, a.b_1_30, a.b_31_60, a.b_61_90, a.b_90plus, a.max_overdue, la.am, la.cabang
    FROM agg a LEFT JOIN last_am la ON la.cid = a.cid
    ORDER BY a.b_90plus DESC, a.total DESC`;
  const customers = rows.map((r) => {
    const b31_60 = Number(r.b_31_60), b61_90 = Number(r.b_61_90), b90plus = Number(r.b_90plus);
    return {
      id: String(r.cid),
      name: r.name ? String(r.name) : `Customer #${r.cid}`,
      cabang: r.cabang ? String(r.cabang) : null,
      am: r.am ? String(r.am) : null,
      invoices: Number(r.invoices),
      total: Number(r.total),
      current: Number(r.b_current),
      b1_30: Number(r.b_1_30),
      b31_60, b61_90, b90plus,
      overdue: b31_60 + b61_90 + b90plus + Number(r.b_1_30),
      max_overdue: Number(r.max_overdue),
      priority: arPriorityOf(b31_60, b61_90, b90plus),
    };
  });
  const sum = (k: "total" | "current" | "b1_30" | "b31_60" | "b61_90" | "b90plus" | "overdue") => customers.reduce((a, c) => a + c[k], 0);
  return {
    summary: {
      total_customers: customers.length,
      total_outstanding: sum("total"),
      overdue_outstanding: sum("overdue"),
      kritis: customers.filter((c) => c.priority === "KRITIS").length,
      buckets: { current: sum("current"), "1-30": sum("b1_30"), "31-60": sum("b31_60"), "61-90": sum("b61_90"), "90+": sum("b90plus") },
    },
    customers,
  };
}
