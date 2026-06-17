import { db } from "../db.js";
import { getAging } from "./ar.js";

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
  sub?: string;
  total: number;
  count: number;
}
const mapRank = (rows: Record<string, unknown>[]): RankRow[] =>
  rows.map((r) => ({
    key: String(r.key ?? ""),
    label: r.label ? String(r.label) : String(r.key ?? "—"),
    sub: r.sub != null && String(r.sub) !== "" ? String(r.sub) : undefined,
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
    SELECT COALESCE(NULLIF(ai.salesman_name,''),'—') AS key,
           COALESCE(NULLIF(mu.nama,''), NULLIF(ai.salesman_name,''),'—') AS label,
           CASE WHEN NULLIF(mu.nama,'') IS NOT NULL
                THEN ai.salesman_name || COALESCE(' · ' || NULLIF(mu.cabang,''), '')
                ELSE NULLIF(mu.cabang,'') END AS sub,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.salesman_name, mu.nama, mu.cabang ORDER BY sum(ai.total) DESC
  `;
  const perCabang = await sql`
    SELECT ai.branch_id::text AS key, COALESCE(NULLIF(ab.name,''), ai.branch_id::text) AS label,
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

// Dashboard "Sales Overview" (gabungan sales + operasional + finance). Satu
// panggilan → KPI (+delta vs periode setara sebelumnya), tren revenue harian,
// breakdown (cabang/produk/customer/sales), recent orders, low-stock, AR aging.
function prevRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  const span = Math.max(t - f, 0) + 86_400_000; // inklusif
  return {
    from: new Date(f - span).toISOString().slice(0, 10),
    to: new Date(f - 86_400_000).toISOString().slice(0, 10),
  };
}
const pctDelta = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;

export async function salesOverview(from: string, to: string) {
  const sql = db();
  const prev = prevRange(from, to);
  const [cur] = await sql`
    SELECT COALESCE(sum(total),0)::numeric AS revenue, count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}`;
  const [pre] = await sql`
    SELECT COALESCE(sum(total),0)::numeric AS revenue, count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${prev.from} AND ${prev.to}`;

  const trend = await sql`
    SELECT tanggal::text AS date, COALESCE(sum(total),0)::numeric AS revenue, count(*)::int AS orders
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}
    GROUP BY tanggal ORDER BY tanggal`;

  const perCabang = await sql`
    SELECT ai.branch_id::text AS key, COALESCE(NULLIF(ab.name,''), 'Cabang #' || ai.branch_id::text) AS label,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_branch ab ON ab.id = ai.branch_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.branch_id, ab.name ORDER BY sum(ai.total) DESC`;
  const perProduct = await sql`
    SELECT aii.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), NULLIF(max(aii.raw->'item'->>'name'),''), 'Item #' || aii.item_id::text) AS label,
           NULLIF(max(it.category),'') AS category,
           sum(aii.total)::numeric AS total, sum(aii.qty)::numeric AS count
    FROM accurate_invoice_item aii JOIN accurate_invoice ai ON ai.id = aii.invoice_id
    LEFT JOIN accurate_item it ON it.id = aii.item_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY aii.item_id, it.name ORDER BY sum(aii.total) DESC LIMIT 8`;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key,
           COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text) AS label,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total) DESC LIMIT 8`;
  const perSalesman = await sql`
    SELECT COALESCE(NULLIF(ai.salesman_name,''),'—') AS key,
           COALESCE(NULLIF(mu.nama,''), NULLIF(ai.salesman_name,''),'—') AS label,
           CASE WHEN NULLIF(mu.nama,'') IS NOT NULL
                THEN ai.salesman_name || COALESCE(' · ' || NULLIF(mu.cabang,''), '')
                ELSE NULLIF(mu.cabang,'') END AS sub,
           sum(ai.total)::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.salesman_name, mu.nama, mu.cabang ORDER BY sum(ai.total) DESC LIMIT 8`;

  // Inventory & order stats (gaya dashboard: total produk, ketersediaan stok, fulfillment).
  const [inv] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE quantity <= 0)::int AS out_stock,
           count(*) FILTER (WHERE quantity > 0 AND quantity <= 5)::int AS low_stock,
           count(*) FILTER (WHERE quantity > 5)::int AS in_stock
    FROM accurate_item WHERE quantity IS NOT NULL`;
  const [soStat] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status ILIKE '%terproses%' OR status ILIKE '%selesai%')::int AS fulfilled,
           count(*) FILTER (WHERE status NOT ILIKE '%tutup%' AND status NOT ILIKE '%batal%')::int AS active
    FROM accurate_sales_order`;

  const recentOrders = await sql`
    SELECT id::text, number, trans_date::text AS trans_date, customer_name, status, total_amount::numeric
    FROM accurate_sales_order ORDER BY trans_date DESC NULLS LAST, id DESC LIMIT 8`;
  const lowStock = await sql`
    SELECT id::text, no, name, quantity::numeric, available::numeric
    FROM accurate_item WHERE quantity IS NOT NULL AND quantity <= 5
    ORDER BY quantity ASC LIMIT 8`;

  let aging: { total_outstanding: number; total_invoices: number; buckets: { bucket: string; count: number; total: number }[] } = {
    total_outstanding: 0,
    total_invoices: 0,
    buckets: [],
  };
  try {
    const ag = await getAging();
    aging = { total_outstanding: ag.total_outstanding, total_invoices: ag.total_invoices, buckets: ag.buckets };
  } catch {
    /* ar_aging_mv mungkin belum ada → kosongkan */
  }

  const revenue = Number(cur?.revenue ?? 0);
  const orders = Number(cur?.orders ?? 0);
  const customers = Number(cur?.customers ?? 0);
  const pRev = Number(pre?.revenue ?? 0);
  const pOrd = Number(pre?.orders ?? 0);
  const pCust = Number(pre?.customers ?? 0);
  return {
    range: { from, to },
    prev_range: prev,
    kpi: {
      revenue,
      revenue_delta: pctDelta(revenue, pRev),
      orders,
      orders_delta: pctDelta(orders, pOrd),
      customers,
      customers_delta: pctDelta(customers, pCust),
      ar_outstanding: aging.total_outstanding,
      ar_invoices: aging.total_invoices,
    },
    inventory: {
      total: Number(inv?.total ?? 0),
      out: Number(inv?.out_stock ?? 0),
      low: Number(inv?.low_stock ?? 0),
      in_stock: Number(inv?.in_stock ?? 0),
    },
    orders_stat: {
      total: Number(soStat?.total ?? 0),
      active: Number(soStat?.active ?? 0),
      fulfilled: Number(soStat?.fulfilled ?? 0),
      fulfillment_pct: Number(soStat?.total ?? 0) > 0 ? Math.round((Number(soStat.fulfilled) / Number(soStat.total)) * 100) : 0,
    },
    trend: trend.map((r) => ({ date: String(r.date), revenue: Number(r.revenue), orders: Number(r.orders) })),
    per_cabang: mapRank(perCabang),
    per_product: perProduct.map((r) => ({
      key: String(r.key ?? ""),
      label: r.label ? String(r.label) : "—",
      category: r.category != null && String(r.category) !== "" ? String(r.category) : null,
      total: Number(r.total ?? 0),
      count: Number(r.count ?? 0),
    })),
    per_customer: mapRank(perCustomer),
    per_salesman: mapRank(perSalesman),
    recent_orders: recentOrders.map((r) => ({
      id: String(r.id),
      number: r.number ? String(r.number) : null,
      trans_date: r.trans_date ? String(r.trans_date) : null,
      customer_name: r.customer_name ? String(r.customer_name) : null,
      status: r.status ? String(r.status) : null,
      total_amount: Number(r.total_amount ?? 0),
    })),
    low_stock: lowStock.map((r) => ({
      id: String(r.id),
      no: r.no ? String(r.no) : null,
      name: r.name ? String(r.name) : null,
      quantity: r.quantity == null ? null : Number(r.quantity),
      available: r.available == null ? null : Number(r.available),
    })),
    ar_aging: aging,
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
  // cabang via salesman → master_user (am_id = master_user_id) → mu.cabang;
  // fallback cabang_override. Jauh lebih ter-petakan drpd branch (yg kosong).
  const byCabang = await sql`
    SELECT COALESCE(NULLIF(mu.cabang, ''), NULLIF(acs.cabang_override, ''), '?') AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.status = 'OPEN' ${dateClause}
    GROUP BY key ORDER BY outstanding DESC
  `;
  // Area East/West: cabang (mu.cabang) dinormalisasi → sales_target_branch.area.
  const byArea = await sql`
    SELECT COALESCE(
             stb.area,
             CASE WHEN UPPER(COALESCE(NULLIF(mu.cabang, ''), NULLIF(acs.cabang_override, ''), '')) = 'OFFICE' THEN 'Office' END,
             'Belum terpetakan'
           ) AS area,
           count(DISTINCT ai.customer_id)::int AS customers,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN sales_target_branch stb ON UPPER(stb.cabang) = CASE UPPER(COALESCE(mu.cabang, ''))
      WHEN 'SBY 2' THEN 'SURABAYA 2'
      WHEN 'SOLO & YOGYAKARTA' THEN 'JAWA TENGAH'
      WHEN 'CIREBON' THEN 'JAWA BARAT'
      ELSE UPPER(COALESCE(mu.cabang, '')) END
    WHERE ai.status = 'OPEN' ${dateClause}
    GROUP BY 1
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
  const areaOf = (name: string) => {
    const r = byArea.find((x) => String(x.area) === name);
    return {
      area: name,
      customers: r ? Number(r.customers) : 0,
      invoices: r ? Number(r.invoices) : 0,
      outstanding: r ? Number(r.outstanding) : 0,
    };
  };
  return {
    total_outstanding: Number(tot?.outstanding ?? 0),
    total_invoices: Number(tot?.invoices ?? 0),
    by_customer: map(byCustomer),
    by_cabang: map(byCabang),
    by_sales: map(bySales),
    areas: {
      east: areaOf("East"),
      west: areaOf("West"),
      office: areaOf("Office"),
      unmapped: areaOf("Belum terpetakan"),
    },
  };
}
