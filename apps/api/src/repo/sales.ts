import { db } from "../db.js";

// Revenue analytics (port wrg-crm Sales Performance) dari accurate_invoice +
// accurate_invoice_item. Outstanding/AR di-skip krn sumber 0. Rentang default
// = awal tahun → hari ini (revenue dilihat year-to-date, beda dgn plan/report).
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function salesDefaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = `${now.getUTCFullYear()}-01-01`;
  return { from, to };
}
export function salesRange(from?: string, to?: string) {
  const d = salesDefaultRange();
  let f = from && ISO.test(from) ? from : d.from;
  let t = to && ISO.test(to) ? to : d.to;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

interface RankRow {
  key: string;
  label: string;
  total: number;
  count: number;
}
const mapRank = (rows: Record<string, unknown>[]): RankRow[] =>
  rows.map((r) => ({
    key: String(r.key ?? ""),
    label: r.label ? String(r.label) : String(r.key ?? "—"),
    total: Number(r.total ?? 0),
    count: Number(r.count ?? 0),
  }));

export async function reportRevenue(from: string, to: string) {
  const sql = db();
  const [tot] = await sql`
    SELECT COALESCE(sum(total),0)::numeric AS total, count(*)::int AS invoices,
           count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}
  `;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key, COALESCE(ac.name, ai.customer_id::text) AS label,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total) DESC LIMIT 25
  `;
  const perSalesman = await sql`
    SELECT COALESCE(salesman_name,'—') AS key, COALESCE(salesman_name,'—') AS label,
           sum(total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}
    GROUP BY salesman_name ORDER BY sum(total) DESC
  `;
  const perCabang = await sql`
    SELECT ai.branch_id::text AS key, COALESCE(ab.name, ai.branch_id::text) AS label,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_branch ab ON ab.id = ai.branch_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.branch_id, ab.name ORDER BY sum(ai.total) DESC
  `;
  const perProduct = await sql`
    SELECT aii.item_id::text AS key, COALESCE(it.name, aii.item_id::text) AS label,
           sum(aii.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice_item aii
    JOIN accurate_invoice ai ON ai.id = aii.invoice_id
    LEFT JOIN accurate_item it ON it.id = aii.item_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY aii.item_id, it.name ORDER BY sum(aii.total) DESC LIMIT 25
  `;
  return {
    from,
    to,
    total: Number(tot?.total ?? 0),
    invoices: Number(tot?.invoices ?? 0),
    customers: Number(tot?.customers ?? 0),
    per_customer: mapRank(perCustomer),
    per_salesman: mapRank(perSalesman),
    per_cabang: mapRank(perCabang),
    per_product: mapRank(perProduct),
  };
}

// AR (piutang) per customer / cabang / sales. Sumber: accurate_invoice status
// OPEN. Kolom `outstanding` tak ter-import (0) → AR diturunkan dari `total`
// invoice OPEN (paid=0). Cabang = cabang_override salesman, fallback nama branch.
// from/to opsional (filter tanggal invoice); default semua OPEN.
export interface ArGroup {
  key: string;
  invoices: number;
  outstanding: number;
}
export async function reportSalesAr(from?: string, to?: string) {
  const sql = db();
  const dateClause =
    from && ISO.test(from) && to && ISO.test(to)
      ? sql`AND ai.tanggal BETWEEN ${from} AND ${to}`
      : sql``;

  const byCustomer = await sql`
    SELECT COALESCE(ac.name, 'Customer #' || ai.customer_id) AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.status = 'OPEN' ${dateClause}
    GROUP BY key ORDER BY outstanding DESC
  `;
  const byCabang = await sql`
    SELECT COALESCE(NULLIF(acs.cabang_override, ''), ab.name, '?') AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN accurate_branch ab ON ab.id = ai.branch_id
    WHERE ai.status = 'OPEN' ${dateClause}
    GROUP BY key ORDER BY outstanding DESC
  `;
  const bySales = await sql`
    SELECT COALESCE(NULLIF(ai.salesman_name, ''), acs.name, 'Sales #' || ai.salesman_id) AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    WHERE ai.status = 'OPEN' ${dateClause}
    GROUP BY key ORDER BY outstanding DESC
  `;
  const [tot] = await sql`
    SELECT count(*)::int AS invoices, COALESCE(sum(total), 0)::float8 AS outstanding
    FROM accurate_invoice WHERE status = 'OPEN'
      ${from && ISO.test(from) && to && ISO.test(to) ? sql`AND tanggal BETWEEN ${from} AND ${to}` : sql``}
  `;
  const map = (rows: Record<string, unknown>[]): ArGroup[] =>
    rows.map((r) => ({ key: String(r.key), invoices: Number(r.invoices), outstanding: Number(r.outstanding) }));
  return {
    total_outstanding: Number(tot?.outstanding ?? 0),
    total_invoices: Number(tot?.invoices ?? 0),
    by_customer: map(byCustomer),
    by_cabang: map(byCabang),
    by_sales: map(bySales),
  };
}
