import { db } from "../db.js";
import { AM_VACANT, joinAmFromSalesman } from "./salesman-am.js";
import { FULL_SCOPE, isRestricted, scopeAccountOwnerClause, scopeAccurateClause, type DataScope } from "./access-scope.js";
import { getAging } from "./ar.js";
import { listTargets, type TargetPeriod } from "./sales-target.js";

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
  target?: number; // target tahunan (hanya utk per-sales & per-cabang)
}
const mapRank = (rows: Record<string, unknown>[]): RankRow[] =>
  rows.map((r) => ({
    key: String(r.key ?? ""),
    label: r.label ? String(r.label) : String(r.key ?? "—"),
    sub: r.sub != null && String(r.sub) !== "" ? String(r.sub) : undefined,
    total: Number(r.total ?? 0),
    count: Number(r.count ?? 0),
    target: r.target != null && Number(r.target) > 0 ? Number(r.target) : undefined,
  }));

export async function reportRevenue(from: string, to: string) {
  const sql = db();
  const year = Number(to.slice(0, 4)); // target tahunan diambil dari tahun akhir rentang
  const [tot] = await sql`
    SELECT COALESCE(sum(total - COALESCE(tax_amount,0)),0)::numeric AS total, count(*)::int AS invoices,
           count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}
  `;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key, COALESCE(ac.name, ai.customer_id::text) AS label,
           sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC
  `;
  // Per-sales + target AM: am_id per grup (via master_user) → join sales_target_am tahun ${year}.
  const perSalesman = await sql`
    SELECT s.key, s.label, s.sub, s.total, s.count, sta.target::numeric AS target
    FROM (
      SELECT COALESCE(NULLIF(mu.am_id,''),'tanpa') AS key,
             COALESCE(NULLIF(max(mu.nama),''), ${AM_VACANT}) AS label,
             COALESCE(NULLIF(max(mu.cabang),''), NULLIF(max(acs.cabang_override),'')) AS sub,
             NULLIF(mu.am_id,'') AS am_id,
             sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${from} AND ${to}
      GROUP BY mu.am_id
    ) s
    LEFT JOIN sales_target_am sta ON sta.am_id = s.am_id AND sta.year = ${year}
    ORDER BY s.total DESC
  `;
  // Cabang via salesman → master_user.cabang (fallback cabang_override). branch_id
  // di accurate_invoice tak ter-isi (semua = 50, accurate_branch.name kosong) →
  // pakai pemetaan salesman spt AR-aging. Lihat reportAr().
  // Per-cabang + target cabang: join langsung sales_target_cabang (cabang text) tahun ${year}.
  const perCabang = await sql`
    SELECT c.key, c.label, c.total, c.count, stc.target::numeric AS target
    FROM (
      SELECT COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS key,
             COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS label,
             sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${from} AND ${to}
      GROUP BY 1
    ) c
    LEFT JOIN sales_target_cabang stc ON stc.cabang = c.key AND stc.year = ${year}
    ORDER BY c.total DESC
  `;
  // Revenue = netto (total−PPN) faktur teralokasi proporsional ke baris → rekonsiliasi ke total.
  const perProduct = await sql`
    WITH inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount,0))::numeric AS inv_net
      FROM accurate_invoice ai WHERE ai.tanggal BETWEEN ${from} AND ${to}
    ),
    line AS (
      SELECT aii.item_id, inv.inv_net, GREATEST(aii.total,0) AS w,
             sum(GREATEST(aii.total,0)) OVER (PARTITION BY aii.invoice_id) AS wsum,
             count(*) OVER (PARTITION BY aii.invoice_id) AS cnt
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    )
    SELECT l.item_id::text AS key, COALESCE(it.name, l.item_id::text) AS label,
           sum(CASE WHEN l.wsum > 0 THEN l.inv_net * l.w / l.wsum ELSE l.inv_net / l.cnt END)::numeric AS total,
           count(*)::int AS count
    FROM line l LEFT JOIN accurate_item it ON it.id = l.item_id
    GROUP BY l.item_id, it.name ORDER BY total DESC
  `;
  // Per-pengadaan (kategori penjualan): custom field Accurate level baris
  // detailItem[].charField1 (REGULAR/KSO/...). Netto faktur teralokasi ke kategori
  // sesuai porsi nilai baris → rekonsiliasi persis ke total (pola analyticsPerPengadaan).
  const perPengadaan = await sql`
    WITH inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount,0))::numeric AS inv_net, ai.raw
      FROM accurate_invoice ai WHERE ai.tanggal BETWEEN ${from} AND ${to} AND ai.raw IS NOT NULL
    ),
    cat AS (
      SELECT inv.id, inv.inv_net,
             COALESCE(NULLIF(d.val->>'charField1',''),'Tanpa kategori') AS kategori,
             COALESCE(sum(GREATEST((d.val->>'totalPrice')::numeric, 0)), 0)::numeric AS w
      FROM inv LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inv.raw->'detailItem','[]'::jsonb)) AS d(val) ON true
      GROUP BY inv.id, inv.inv_net, COALESCE(NULLIF(d.val->>'charField1',''),'Tanpa kategori')
    ),
    share AS (
      SELECT id, inv_net, kategori, w,
             sum(w) OVER (PARTITION BY id) AS wsum, count(*) OVER (PARTITION BY id) AS cnt
      FROM cat
    )
    SELECT kategori AS key, kategori AS label,
           sum(CASE WHEN wsum > 0 THEN inv_net * w / wsum ELSE inv_net / cnt END)::numeric AS total,
           count(DISTINCT id)::int AS count
    FROM share GROUP BY kategori ORDER BY total DESC
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
    per_pengadaan: mapRank(perPengadaan),
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
    SELECT COALESCE(sum(total - COALESCE(tax_amount,0)),0)::numeric AS revenue, count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}`;
  const [pre] = await sql`
    SELECT COALESCE(sum(total - COALESCE(tax_amount,0)),0)::numeric AS revenue, count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers
    FROM accurate_invoice WHERE tanggal BETWEEN ${prev.from} AND ${prev.to}`;

  const trend = await sql`
    SELECT tanggal::text AS date, COALESCE(sum(total - COALESCE(tax_amount,0)),0)::numeric AS revenue, count(*)::int AS orders
    FROM accurate_invoice WHERE tanggal BETWEEN ${from} AND ${to}
    GROUP BY tanggal ORDER BY tanggal`;

  // Cabang via salesman → master_user.cabang (branch_id invoice kosong, semua=50).
  const perCabang = await sql`
    SELECT COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS key,
           COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS label,
           sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC`;
  // Top Produk = netto faktur teralokasi proporsional ke baris (rekonsiliasi ke KPI revenue).
  const perProduct = await sql`
    WITH inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount,0))::numeric AS inv_net
      FROM accurate_invoice ai WHERE ai.tanggal BETWEEN ${from} AND ${to}
    ),
    line AS (
      SELECT aii.item_id, aii.qty, inv.inv_net, aii.raw->'item'->>'name' AS raw_name,
             GREATEST(aii.total,0) AS w,
             sum(GREATEST(aii.total,0)) OVER (PARTITION BY aii.invoice_id) AS wsum,
             count(*) OVER (PARTITION BY aii.invoice_id) AS cnt
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    )
    SELECT l.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), NULLIF(max(l.raw_name),''), 'Item #' || l.item_id::text) AS label,
           NULLIF(max(it.category),'') AS category,
           sum(CASE WHEN l.wsum > 0 THEN l.inv_net * l.w / l.wsum ELSE l.inv_net / l.cnt END)::numeric AS total,
           sum(l.qty)::numeric AS count
    FROM line l LEFT JOIN accurate_item it ON it.id = l.item_id
    GROUP BY l.item_id, it.name ORDER BY total DESC LIMIT 8`;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key,
           COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text) AS label,
           sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC LIMIT 8`;
  const perSalesman = await sql`
    SELECT COALESCE(NULLIF(mu.am_id,''),'tanpa') AS key,
           COALESCE(NULLIF(max(mu.nama),''), ${AM_VACANT}) AS label,
           COALESCE(NULLIF(max(mu.cabang),''), NULLIF(max(acs.cabang_override),'')) AS sub,
           sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY mu.am_id ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC LIMIT 8`;

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
// Scope (F122): AM hanya invoice atas namanya, HoD hanya cabang timnya. Semua
// query di sini WAJIB ikut di-scope — termasuk total, kalau tidak angka kartu
// jadi org-wide sementara tabelnya per-AM.
export async function reportSalesAr(from?: string, to?: string, scope: DataScope = FULL_SCOPE) {
  const sql = db();
  const dateClause =
    from && ISO.test(from) && to && ISO.test(to)
      ? sql`AND ai.tanggal BETWEEN ${from} AND ${to}`
      : sql``;
  const scl = scopeAccurateClause(sql, scope);

  const byCustomer = await sql`
    SELECT COALESCE(ac.name, 'Customer #' || ai.customer_id) AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' ${dateClause} ${scl}
    GROUP BY key ORDER BY outstanding DESC
  `;
  // cabang via salesman → master_user (am_id = master_user_id) → mu.cabang;
  // fallback cabang_override. Kode salesman yg nyangkut sudah di-resolve di
  // joinAmFromSalesman (dulu CTE sm_map lokal di sini).
  const byCabang = await sql`
    SELECT COALESCE(NULLIF(mu.cabang, ''), NULLIF(acs.cabang_override, ''), '(Tanpa cabang)') AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' ${dateClause} ${scl}
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
    ${joinAmFromSalesman(sql)}
    LEFT JOIN sales_target_branch stb ON UPPER(stb.cabang) = CASE UPPER(COALESCE(mu.cabang, ''))
      WHEN 'SBY 2' THEN 'SURABAYA 2'
      WHEN 'SOLO & YOGYAKARTA' THEN 'JAWA TENGAH'
      WHEN 'CIREBON' THEN 'JAWA BARAT'
      ELSE UPPER(COALESCE(mu.cabang, '')) END
    WHERE ai.status = 'OPEN' ${dateClause} ${scl}
    GROUP BY 1
  `;
  // Per sales pakai NAMA lengkap (master_user.nama via salesman→am_id), bukan
  // kode Accurate (LRI/GGA/…) — resolusi kode nyangkut ada di joinAmFromSalesman.
  // Sisa yg tak bisa diatribusikan melebur jadi satu baris VACANT.
  const bySales = await sql`
    SELECT COALESCE(NULLIF(mu.nama, ''), ${AM_VACANT}) AS key,
           count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' ${dateClause} ${scl}
    GROUP BY key ORDER BY outstanding DESC
  `;
  const [tot] = await sql`
    SELECT count(*)::int AS invoices, COALESCE(sum(ai.total), 0)::float8 AS outstanding
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' ${dateClause} ${scl}
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

// Monitoring revenue ter-faktur per customer (dari accurate_invoice). Per customer:
// total revenue, jumlah faktur, transaksi terakhir, hari sejak transaksi terakhir,
// revenue bulan ini, + flag dormant (>60 hari tanpa faktur).
const DORMANT_DAYS = 60;
// Tier prioritas follow-up dari hari sejak transaksi terakhir.
function priorityOf(days: number | null): "AKTIF" | "MONITOR" | "TINGGI" | "KRITIS" {
  if (days == null || days < DORMANT_DAYS) return "AKTIF";
  if (days >= 120) return "KRITIS";
  if (days >= 100) return "TINGGI";
  return "MONITOR";
}
const BLN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Scope customer-centric (F122) pakai pemilik EKSPLISIT crm_account.owner_am_id
// (migrasi 064), bukan salesman invoice — supaya kepemilikan tak berpindah
// sendiri tiap ada invoice dari AM lain, dan prospek tanpa invoice tetap bisa
// di-scope. Angka revenue tetap TOTAL customer itu (semua invoice), karena ini
// pandangan per-customer, bukan komisi per-AM.
export async function customersRevenue(scope: DataScope = FULL_SCOPE) {
  const sql = db();
  const rows = await sql`
    SELECT ai.customer_id::text AS id,
      COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text) AS name,
      NULLIF(mode() WITHIN GROUP (ORDER BY NULLIF(mu.cabang,'')), '') AS cabang,
      sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total,
      count(*)::int AS invoices,
      max(ai.tanggal)::text AS last_date,
      (CURRENT_DATE - max(ai.tanggal))::int AS days_since,
      COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)) FILTER (WHERE ai.tanggal >= date_trunc('month', CURRENT_DATE) - interval '2 month' AND ai.tanggal < date_trunc('month', CURRENT_DATE) - interval '1 month'), 0)::float8 AS m2,
      COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)) FILTER (WHERE ai.tanggal >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND ai.tanggal < date_trunc('month', CURRENT_DATE)), 0)::float8 AS m1,
      COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)) FILTER (WHERE ai.tanggal >= date_trunc('month', CURRENT_DATE)), 0)::float8 AS m0,
      count(*) FILTER (WHERE ai.tanggal >= date_trunc('month', CURRENT_DATE))::int AS this_month_inv
    FROM accurate_invoice ai
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    LEFT JOIN crm_account oa ON oa.account_id = ai.customer_id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    WHERE ai.customer_id IS NOT NULL ${scopeAccountOwnerClause(sql, scope)}
    GROUP BY ai.customer_id, ac.name
    ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC NULLS LAST
  `;
  // Breakdown bulanan YTD (sejak Januari tahun berjalan) per customer — dipakai export.
  const now = new Date();
  const ytdKeys: string[] = [];
  const ytdLabels: string[] = [];
  for (let mo = 0; mo <= now.getMonth(); mo++) {
    ytdKeys.push(`${now.getFullYear()}-${String(mo + 1).padStart(2, "0")}`);
    ytdLabels.push(`${BLN_ID[mo]} ${now.getFullYear()}`);
  }
  const ytdRows = await sql`
    SELECT ai.customer_id::text AS id, to_char(date_trunc('month', ai.tanggal), 'YYYY-MM') AS ym, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total
    FROM accurate_invoice ai
    LEFT JOIN crm_account oa ON oa.account_id = ai.customer_id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    WHERE ai.customer_id IS NOT NULL AND ai.tanggal >= date_trunc('year', CURRENT_DATE)
      ${scopeAccountOwnerClause(sql, scope)}
    GROUP BY 1, 2
  `;
  const ytdMap = new Map<string, Record<string, number>>();
  for (const r of ytdRows) {
    const id = String(r.id);
    if (!ytdMap.has(id)) ytdMap.set(id, {});
    ytdMap.get(id)![String(r.ym)] = Number(r.total);
  }
  const customers = rows.map((r) => {
    const days = r.days_since == null ? null : Number(r.days_since);
    return {
      id: String(r.id),
      name: String(r.name),
      cabang: r.cabang ? String(r.cabang) : null,
      total: Number(r.total),
      invoices: Number(r.invoices),
      last_date: r.last_date ? String(r.last_date) : null,
      days_since: days,
      m2: Number(r.m2),
      m1: Number(r.m1),
      m0: Number(r.m0),
      ytd: ytdKeys.map((k) => ytdMap.get(String(r.id))?.[k] ?? 0),
      this_month: Number(r.m0),
      this_month_inv: Number(r.this_month_inv),
      priority: priorityOf(days),
      dormant: days != null && days > DORMANT_DAYS,
    };
  });
  const lab = (back: number) => BLN_ID[new Date(now.getFullYear(), now.getMonth() - back, 1).getMonth()];
  const summary = {
    total_customers: customers.length,
    active: customers.filter((c) => !c.dormant).length,
    dormant: customers.filter((c) => c.dormant).length,
    kritis: customers.filter((c) => c.priority === "KRITIS").length,
    tinggi: customers.filter((c) => c.priority === "TINGGI").length,
    revenue_total: customers.reduce((a, c) => a + c.total, 0),
    revenue_month: customers.reduce((a, c) => a + c.m0, 0),
    invoices_month: customers.reduce((a, c) => a + c.this_month_inv, 0),
  };
  return { dormant_days: DORMANT_DAYS, months: [lab(2), lab(1), lab(0)], ytd_months: ytdLabels, summary, customers };
}

// Win-back: customer dormant ≥ minDays sejak invoice TERAKHIR, prioritas revenue
// historis (all-time). AM = salesman invoice terakhir (paling relevan utk follow-up).
export async function dormantCustomers(minDays = 60, scope: DataScope = FULL_SCOPE) {
  const sql = db();
  const md = Math.min(Math.max(Math.trunc(Number(minDays) || 60), 1), 3650);
  const rows = await sql`
    WITH cust AS (
      SELECT ai.customer_id AS cid,
        COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text) AS name,
        NULLIF(mode() WITHIN GROUP (ORDER BY NULLIF(mu.cabang,'')), '') AS cabang,
        sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total,
        count(*)::int AS invoices,
        max(ai.tanggal)::text AS last_date,
        (CURRENT_DATE - max(ai.tanggal))::int AS days_since
      FROM accurate_invoice ai
      LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      LEFT JOIN crm_account oa ON oa.account_id = ai.customer_id
      LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
      WHERE ai.customer_id IS NOT NULL ${scopeAccountOwnerClause(sql, scope)}
      GROUP BY ai.customer_id, ac.name
    ),
    last_am AS (
      SELECT DISTINCT ON (ai.customer_id) ai.customer_id AS cid,
        COALESCE(NULLIF(mu.nama,''), ${AM_VACANT}) AS am
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.customer_id IS NOT NULL
      ORDER BY ai.customer_id, ai.tanggal DESC
    )
    SELECT c.cid::text AS id, c.name, c.cabang, c.total, c.invoices, c.last_date, c.days_since, la.am
    FROM cust c LEFT JOIN last_am la ON la.cid = c.cid
    WHERE c.days_since >= ${md}
    ORDER BY c.total DESC NULLS LAST`;
  const customers = rows.map((r) => ({
    id: String(r.id), name: String(r.name), cabang: r.cabang ? String(r.cabang) : null,
    total: Number(r.total), invoices: Number(r.invoices),
    last_date: r.last_date ? String(r.last_date) : null,
    days_since: r.days_since == null ? null : Number(r.days_since),
    am: r.am ? String(r.am) : null,
  }));
  return { summary: { min_days: md, count: customers.length, value_at_risk: customers.reduce((a, c) => a + c.total, 0) }, customers };
}

// F77 Churn Early Warning — klasifikasi 3-tier per customer dari histori faktur
// Accurate (recency-based, sesuai blueprint). Threshold parameter (default sinkron
// dgn DORMANT_DAYS=60, rutin=≥3 order). Fase 1 = deteksi/dashboard read-only
// (belum cron/WA). Tier:
//   active = pelanggan RUTIN (≥ROUTINE_MIN order) & no-order >churnDays  → sudah berhenti
//   risk   = masih order (≤churnDays) tapi frekuensi turun >50% vs baseline 3 bln
//   watch  = pelanggan umum (<ROUTINE_MIN order) & no-order >churnDays   → sinyal ringan
export type ChurnTier = "active" | "risk" | "watch";
const ROUTINE_MIN = 3; // ambang "pelanggan rutin" (Decision Ask #14 masih tentatif)
function classifyChurn(invoices: number, days: number | null, recent90: number, prior90: number, churnDays: number): ChurnTier | null {
  if (days != null && days > churnDays) return invoices >= ROUTINE_MIN ? "active" : "watch";
  // masih aktif (≤churnDays): deteksi penurunan frekuensi vs baseline 3 bln sebelumnya
  if (prior90 >= 2 && recent90 < prior90 * 0.5) return "risk";
  return null; // sehat — bukan churn
}
export async function churnCustomers(churnDays0 = DORMANT_DAYS, scope: DataScope = FULL_SCOPE) {
  const sql = db();
  const churnDays = Math.min(Math.max(Math.trunc(Number(churnDays0) || DORMANT_DAYS), 1), 3650);
  const rows = await sql`
    WITH cust AS (
      SELECT ai.customer_id AS cid,
        COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text) AS name,
        NULLIF(mode() WITHIN GROUP (ORDER BY NULLIF(mu.cabang,'')), '') AS cabang,
        sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total,
        count(*)::int AS invoices,
        max(ai.tanggal)::text AS last_date,
        (CURRENT_DATE - max(ai.tanggal))::int AS days_since,
        count(*) FILTER (WHERE ai.tanggal > CURRENT_DATE - 90)::int AS recent90,
        count(*) FILTER (WHERE ai.tanggal <= CURRENT_DATE - 90 AND ai.tanggal > CURRENT_DATE - 180)::int AS prior90
      FROM accurate_invoice ai
      LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      LEFT JOIN crm_account oa ON oa.account_id = ai.customer_id
      LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
      WHERE ai.customer_id IS NOT NULL ${scopeAccountOwnerClause(sql, scope)}
      GROUP BY ai.customer_id, ac.name
    ),
    last_am AS (
      SELECT DISTINCT ON (ai.customer_id) ai.customer_id AS cid,
        COALESCE(NULLIF(mu.nama,''), ${AM_VACANT}) AS am
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.customer_id IS NOT NULL
      ORDER BY ai.customer_id, ai.tanggal DESC
    )
    SELECT c.cid::text AS id, c.name, c.cabang, c.total, c.invoices, c.last_date, c.days_since, c.recent90, c.prior90, la.am
    FROM cust c LEFT JOIN last_am la ON la.cid = c.cid
    ORDER BY c.total DESC NULLS LAST`;
  const customers = rows.flatMap((r) => {
    const days = r.days_since == null ? null : Number(r.days_since);
    const invoices = Number(r.invoices);
    const recent90 = Number(r.recent90);
    const prior90 = Number(r.prior90);
    const tier = classifyChurn(invoices, days, recent90, prior90, churnDays);
    if (!tier) return [];
    return [{
      id: String(r.id), name: String(r.name), cabang: r.cabang ? String(r.cabang) : null,
      total: Number(r.total), invoices,
      last_date: r.last_date ? String(r.last_date) : null,
      days_since: days, recent90, prior90,
      am: r.am ? String(r.am) : null,
      tier,
    }];
  });
  const byTier = (t: ChurnTier) => customers.filter((c) => c.tier === t);
  const summary = {
    churn_days: churnDays,
    routine_min: ROUTINE_MIN,
    total: customers.length,
    active: byTier("active").length,
    risk: byTier("risk").length,
    watch: byTier("watch").length,
    value_at_risk: customers.reduce((a, c) => a + c.total, 0),
  };
  return { summary, customers };
}

// Target Pacing — target vs actual (YTD tahun berjalan) per AM & cabang + proyeksi.
// Pace = actual / (target × fraksi tahun berlalu). status: on-track ≥1 · at-risk ≥0.9 ·
// behind <0.9. projected = actual / fraksi (ekstrapolasi linear ke akhir tahun).
export async function targetPacing(year0?: number) {
  const sql = db();
  const now = new Date();
  const year = year0 && year0 > 2000 ? Math.trunc(year0) : now.getFullYear();
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const f = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const elapsed = f <= 0 ? 0.0001 : f;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const enrich = (target: number, actual: number) => {
    const achievement_pct = target > 0 ? round1((actual / target) * 100) : null;
    const expected = target * f;
    const pace = expected > 0 ? actual / expected : null;
    const projected = actual / elapsed;
    const projected_pct = target > 0 ? round1((projected / target) * 100) : null;
    const status = pace == null ? "n/a" : pace >= 1 ? "on-track" : pace >= 0.9 ? "at-risk" : "behind";
    return { target, actual, achievement_pct, expected: Math.round(expected), pace: pace == null ? null : round1(pace * 100), projected: Math.round(projected), projected_pct, status };
  };
  const amRows = await sql`
    WITH act AS (
      SELECT mu.am_id AS am_id, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS actual
      FROM accurate_invoice ai
      JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE date_part('year', ai.tanggal) = ${year}
      GROUP BY mu.am_id
    )
    SELECT t.am_id, COALESCE(NULLIF(mu.nama,''), t.am_id) AS nama, NULLIF(mu.cabang,'') AS cabang,
           t.target::float8 AS target, COALESCE(a.actual,0)::float8 AS actual
    FROM sales_target_am t
    LEFT JOIN master_user mu ON mu.am_id = t.am_id
    LEFT JOIN act a ON a.am_id = t.am_id
    WHERE t.year = ${year} AND t.target > 0
    ORDER BY t.target DESC`;
  const cbRows = await sql`
    WITH act AS (
      SELECT COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) AS cabang, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS actual
      FROM accurate_invoice ai
      JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE date_part('year', ai.tanggal) = ${year}
      GROUP BY 1
    )
    SELECT t.cabang, t.target::float8 AS target, COALESCE(a.actual,0)::float8 AS actual
    FROM sales_target_cabang t LEFT JOIN act a ON a.cabang = t.cabang
    WHERE t.year = ${year} AND t.target > 0
    ORDER BY t.target DESC`;
  const am = amRows.map((r) => ({ am_id: String(r.am_id), nama: String(r.nama), cabang: r.cabang ? String(r.cabang) : null, ...enrich(Number(r.target), Number(r.actual)) }));
  const cabang = cbRows.map((r) => ({ cabang: String(r.cabang), ...enrich(Number(r.target), Number(r.actual)) }));
  const sum = (arr: { target: number; actual: number }[]) => ({ target: arr.reduce((a, x) => a + x.target, 0), actual: arr.reduce((a, x) => a + x.actual, 0) });
  return { year, elapsed_pct: Math.round(f * 1000) / 10, am, cabang, summary: { am: sum(am), cabang: sum(cabang) } };
}

// Rincian revenue per bulan satu customer (default 12 bulan terakhir) — on-demand.
// Drill-down 1 customer: ikut scope pemilik akun. Di luar scope → name null +
// monthly kosong (sama seperti customer tanpa data), tak membocorkan angkanya.
export async function customerMonthly(id: string, months = 12, scope: DataScope = FULL_SCOPE): Promise<{
  name: string | null;
  monthly: { month: string; total: number; count: number }[];
}> {
  const sql = db();
  const m = Math.min(Math.max(months, 1), 36);
  if (isRestricted(scope)) {
    const [own] = await sql`
      SELECT 1 FROM crm_account oa
      LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
      WHERE oa.account_id = ${Number(id)} ${scopeAccountOwnerClause(sql, scope)}
      LIMIT 1`;
    if (!own) return { name: null, monthly: [] };
  }
  const [meta] = await sql`
    SELECT COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), 'Customer #' || ${id}) AS name
    FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.customer_id = ${Number(id)} GROUP BY ac.name LIMIT 1
  `;
  const rows = await sql`
    SELECT to_char(date_trunc('month', tanggal), 'YYYY-MM') AS month,
      sum(total - COALESCE(tax_amount,0))::float8 AS total, count(*)::int AS count
    FROM accurate_invoice
    WHERE customer_id = ${Number(id)}
      AND tanggal >= date_trunc('month', CURRENT_DATE) - make_interval(months => ${m - 1})
    GROUP BY 1 ORDER BY 1
  `;
  return {
    name: meta?.name ? String(meta.name) : null,
    monthly: rows.map((r) => ({ month: String(r.month), total: Number(r.total), count: Number(r.count) })),
  };
}

// ── Sales Performance (kartu target vs realisasi per periode + region) ──
// Kartu bersifat periodik (YTD / kuartal / bulan berjalan) relatif "hari ini",
// independen dari filter Dari/Sampai (yg menggerakkan tabel breakdown).
//   - Target  : tabel sales_target per tahun (menu Admin → Sales Targets).
//   - Region  : cabang → HoD (tabel hod_territory / menu WatchPoint Territory) →
//               rocky=East, yogi=West (dua HoD Sales), selain itu → OFFICE.

export type Region = "OFFICE" | "West" | "East";
const REGIONS: Region[] = ["East", "West", "OFFICE"];

const p2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

interface Range {
  from: string;
  to: string;
}
// Boundary periode dari as-of (YYYY-MM-DD): YTD, kuartal-to-date, month-to-date,
// dan periode setara bulan lalu (tgl 1 → hari yg sama, di-clamp ke akhir bulan).
export function periodRanges(asOf: string): { year: Range; quarter: Range; month: Range; monthPrev: Range } {
  const [Y, M, D] = asOf.split("-").map(Number);
  const qStartMonth = Math.floor((M - 1) / 3) * 3 + 1;
  const pmY = M === 1 ? Y - 1 : Y;
  const pmM = M === 1 ? 12 : M - 1;
  const daysInPrevMonth = new Date(Date.UTC(pmY, pmM, 0)).getUTCDate(); // hari terakhir bulan lalu
  const pmD = Math.min(D, daysInPrevMonth);
  return {
    year: { from: isoDate(Y, 1, 1), to: asOf },
    quarter: { from: isoDate(Y, qStartMonth, 1), to: asOf },
    month: { from: isoDate(Y, M, 1), to: asOf },
    monthPrev: { from: isoDate(pmY, pmM, 1), to: isoDate(pmY, pmM, pmD) },
  };
}

// Peta cabang → region dari hod_territory (WatchPoint). Hanya HoD Sales yg jadi
// region: rocky→East, yogi→West. Cabang lain / tak ter-map → OFFICE (default).
export async function cabangRegionMap(sql: ReturnType<typeof db>): Promise<Record<string, Region>> {
  const rows = await sql<{ hod_key: string; cabang: string }[]>`SELECT hod_key, cabang FROM hod_territory`;
  const map: Record<string, Region> = {};
  for (const r of rows) {
    const region: Region | null = r.hod_key === "rocky" ? "East" : r.hod_key === "yogi" ? "West" : null;
    if (region) map[r.cabang] = region;
  }
  return map;
}

type RegionTotals = Record<Region, number>;
const zeroRegions = (): RegionTotals => ({ OFFICE: 0, West: 0, East: 0 });

// Total revenue + breakdown per region untuk satu rentang. Cabang dipetakan lewat
// salesman → master_user.cabang (fallback cabang_override), sama spt reportRevenue.
async function periodAgg(
  sql: ReturnType<typeof db>,
  from: string,
  to: string,
  regionMap: Record<string, Region>,
): Promise<{ total: number; regions: RegionTotals }> {
  const rows = await sql`
    SELECT COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS cabang,
           sum(ai.total - COALESCE(ai.tax_amount,0))::numeric AS total
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
    GROUP BY 1
  `;
  const regions = zeroRegions();
  let total = 0;
  for (const r of rows) {
    const v = Number((r as Record<string, unknown>).total ?? 0);
    total += v;
    const cabang = String((r as Record<string, unknown>).cabang ?? "");
    regions[regionMap[cabang] ?? "OFFICE"] += v;
  }
  return { total, regions };
}

const pctOr = (num: number, den: number | null): number | null =>
  den == null || den <= 0 ? null : Math.round((num / den) * 1000) / 10;

export async function reportSalesPerformance(asOf?: string) {
  const sql = db();
  const today = asOf && ISO.test(asOf) ? asOf : salesDefaultRange().to;
  const R = periodRanges(today);
  const yr = Number(today.slice(0, 4));
  const regionMap = await cabangRegionMap(sql);
  const [targets, year, quarter, month, monthPrev] = await Promise.all([
    listTargets(yr),
    periodAgg(sql, R.year.from, R.year.to, regionMap),
    periodAgg(sql, R.quarter.from, R.quarter.to, regionMap),
    periodAgg(sql, R.month.from, R.month.to, regionMap),
    periodAgg(sql, R.monthPrev.from, R.monthPrev.to, regionMap),
  ]);

  // Lookup target[period][region] (null bila belum diisi utk tahun ini).
  const tgt = (period: TargetPeriod, region: "East" | "West"): number | null =>
    targets.find((t) => t.period === period && t.region === region)?.target ?? null;

  const mk = (
    key: TargetPeriod,
    label: string,
    range: Range,
    agg: { total: number; regions: RegionTotals },
  ) => {
    const east = tgt(key, "East");
    const west = tgt(key, "West");
    const total = east != null && west != null ? east + west : null;
    return {
      key,
      label,
      from: range.from,
      to: range.to,
      total: agg.total,
      regions: REGIONS.map((r) => ({ region: r, total: agg.regions[r] })),
      target: { east, west, total },
      pct: { total: pctOr(agg.total, total), east: pctOr(agg.regions.East, east), west: pctOr(agg.regions.West, west) },
    };
  };

  const growth = monthPrev.total > 0 ? Math.round(((month.total - monthPrev.total) / monthPrev.total) * 1000) / 10 : null;

  return {
    as_of: today,
    periods: [
      mk("year", "Sales YTD", R.year, year),
      mk("quarter", "Sales This Quarter", R.quarter, quarter),
      mk("month", "Sales This Month", R.month, month),
    ],
    mtd_vs_last: {
      current: { from: R.month.from, to: R.month.to, total: month.total },
      previous: { from: R.monthPrev.from, to: R.monthPrev.to, total: monthPrev.total },
      growth_pct: growth,
    },
  };
}
