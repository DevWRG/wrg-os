// F127 Sales Analytics — lapisan analitik multi-dimensi di atas data Accurate.
// Reuse pola JOIN & helper dari sales.ts (cabang via salesman→master_user,
// region via hod_territory). Row-level scope via access-scope.ts (AM→self).
//
// 6 view: overview, per-am (+drilldown), per-produk, per-cabang, per-customer,
// trending. Full case reuse fungsi sales.ts yang sudah teruji; case AM pakai
// query ber-scope (klausa `AND mu.am_id = ...`).

import { db } from "../db.js";
import {
  salesRange,
  salesOverview,
  reportSalesPerformance,
  customersRevenue,
  cabangRegionMap,
  type Region,
} from "./sales.js";
import { isRestricted, type DataScope } from "./access-scope.js";

const yearOf = (to: string): number => Number(to.slice(0, 4));
const pct = (num: number, den: number | null | undefined): number | null =>
  den && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// Klausa scope row-level (query yang join accurate_salesman→master_user):
//   AM  → AND mu.am_id = <amId>
//   HoD → AND cabang ∈ cabangScope (tim HoD)
//   lainnya → kosong (lihat semua)
function scopeClause(sql: ReturnType<typeof db>, scope: DataScope) {
  if (scope.amOnly && scope.amId) return sql`AND mu.am_id = ${scope.amId}`;
  if (scope.cabangScope && scope.cabangScope.length)
    return sql`AND COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) = ANY(${scope.cabangScope}::text[])`;
  return sql``;
}

// ── View #1: Executive Overview ───────────────────────────────────
export async function analyticsOverview(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };

  if (isRestricted(sc)) {
    // Overview ber-scope (AM = data sendiri; HoD = cabang tim). Shape "am".
    const sql = db();
    const scl = scopeClause(sql, sc);
    const [kpi] = await sql`
      SELECT COALESCE(sum(ai.total),0)::float8 AS revenue, count(*)::int AS orders,
             count(DISTINCT ai.customer_id)::int AS customers
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scl}`;
    const trend = await sql`
      SELECT ai.tanggal::text AS date, COALESCE(sum(ai.total),0)::float8 AS revenue, count(*)::int AS orders
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scl}
      GROUP BY ai.tanggal ORDER BY ai.tanggal`;
    // Target hanya untuk AM (target per-AM). HoD lintas-cabang → target null.
    const tgt = sc.amOnly && sc.amId
      ? (await sql`SELECT target::float8 FROM sales_target_am WHERE am_id = ${sc.amId} AND year = ${yearOf(to)}`)[0]
      : undefined;
    const target = tgt?.target != null ? Number(tgt.target) : null;
    return {
      scope: "am" as const,
      range: { from, to },
      kpi: {
        revenue: Number(kpi?.revenue ?? 0),
        orders: Number(kpi?.orders ?? 0),
        customers: Number(kpi?.customers ?? 0),
        target,
        achievement_pct: pct(Number(kpi?.revenue ?? 0), target),
      },
      trend: trend.map((r) => ({ date: String(r.date), revenue: Number(r.revenue), orders: Number(r.orders) })),
    };
  }

  // Full: reuse salesOverview (KPI+delta+tren+breakdown) + kartu region (F5).
  const [ov, perf] = await Promise.all([salesOverview(from, to), reportSalesPerformance(to)]);
  return { scope: "all" as const, ...ov, performance: perf };
}

// ── View #2: Per-AM Performance ───────────────────────────────────
export interface AmRow {
  am_id: string | null;
  nama: string | null;
  cabang: string | null;
  region: Region;
  total: number;
  count: number;
  target: number | null;
  achievement_pct: number | null;
  rank: number;
  self?: boolean;
}

export async function analyticsPerAm(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const year = yearOf(to);
  const regionMap = await cabangRegionMap(sql);
  const rows = await sql`
    SELECT mu.am_id AS am_id,
           COALESCE(NULLIF(max(mu.nama),''), NULLIF(max(ai.salesman_name),''), 'Tanpa sales') AS nama,
           NULLIF(max(mu.cabang),'') AS cabang,
           sum(ai.total)::float8 AS total, count(*)::int AS count,
           max(sta.target)::float8 AS target
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN sales_target_am sta ON sta.am_id = mu.am_id AND sta.year = ${year}
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY mu.am_id
    ORDER BY sum(ai.total) DESC NULLS LAST`;

  let ranked: AmRow[] = rows.map((r, i) => {
    const amId = r.am_id ? String(r.am_id) : null;
    const cabang = r.cabang ? String(r.cabang) : null;
    const total = Number(r.total ?? 0);
    const target = r.target != null ? Number(r.target) : null;
    return {
      am_id: amId,
      nama: r.nama ? String(r.nama) : null,
      cabang,
      region: (cabang && regionMap[cabang]) || "OFFICE",
      total,
      count: Number(r.count ?? 0),
      target,
      achievement_pct: pct(total, target),
      rank: i + 1,
      self: amId != null && amId === sc.amId,
    };
  });

  // Scope AM: anonimkan peer (nama & am_id disembunyikan) — tampilkan peringkat saja.
  if (sc.amOnly && sc.amId) {
    ranked = ranked.map((r) =>
      r.self ? r : { ...r, am_id: null, nama: `Peringkat ${r.rank}`, cabang: null },
    );
  }
  return { scope: sc.amOnly ? ("am" as const) : ("all" as const), range: { from, to }, rows: ranked, total: ranked.length };
}

// ── View #2b: drilldown satu AM (per-produk + per-customer) ────────
export async function analyticsPerAmDrilldown(amId: string, from0?: string, to0?: string, scope?: DataScope) {
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  if (sc.amOnly && sc.amId && sc.amId !== amId) {
    throw Object.assign(new Error("AM hanya boleh membuka data sendiri"), { status: 403 });
  }
  const { from, to } = salesRange(from0, to0);
  const sql = db();
  const perProduk = await sql`
    SELECT aii.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), 'Item #' || aii.item_id::text) AS label,
           sum(aii.total)::float8 AS total, sum(aii.qty)::float8 AS qty
    FROM accurate_invoice_item aii
    JOIN accurate_invoice ai ON ai.id = aii.invoice_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_item it ON it.id = aii.item_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id = ${amId}
    GROUP BY aii.item_id, it.name ORDER BY sum(aii.total) DESC LIMIT 20`;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key,
           COALESCE(NULLIF(ac.name,''), 'Customer #' || ai.customer_id::text) AS label,
           sum(ai.total)::float8 AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id = ${amId}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total) DESC LIMIT 10`;
  return {
    am_id: amId,
    range: { from, to },
    per_produk: perProduk.map((r) => ({ key: String(r.key), label: String(r.label), total: Number(r.total), qty: Number(r.qty) })),
    per_customer: perCustomer.map((r) => ({ key: String(r.key), label: String(r.label), total: Number(r.total), count: Number(r.count) })),
  };
}

// ── View #3: Per-Produk Portfolio ─────────────────────────────────
export async function analyticsPerProduk(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const rows = await sql`
    SELECT aii.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), NULLIF(max(aii.raw->'item'->>'name'),''), 'Item #' || aii.item_id::text) AS label,
           NULLIF(max(it.category),'') AS category,
           NULLIF(max(it.unit),'') AS satuan,
           max(it.quantity)::float8 AS stock_on_hand,
           sum(aii.total)::float8 AS total, sum(aii.qty)::float8 AS unit_sold,
           count(DISTINCT ai.customer_id)::int AS customer_count
    FROM accurate_invoice_item aii
    JOIN accurate_invoice ai ON ai.id = aii.invoice_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_item it ON it.id = aii.item_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY aii.item_id, it.name ORDER BY sum(aii.total) DESC LIMIT 200`;
  return {
    scope: sc.amOnly ? ("am" as const) : ("all" as const),
    range: { from, to },
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      category: r.category ? String(r.category) : null,
      satuan: r.satuan ? String(r.satuan) : null,
      stock_on_hand: r.stock_on_hand == null ? null : Number(r.stock_on_hand),
      total: Number(r.total),
      unit_sold: Number(r.unit_sold),
      customer_count: Number(r.customer_count),
    })),
  };
}

// ── View: Per-Pengadaan (kategori penjualan REGULAR/KSO) ──────────
// Di-konsolidasi dari Sales Performance (sales.ts). Kategori = custom field
// Accurate level baris: detailItem[].charField1. Revenue = totalPrice baris.
// Scope: join accurate_salesman→master_user agar bisa difilter AM/HoD.
export async function analyticsPerPengadaan(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const rows = await sql`
    SELECT COALESCE(NULLIF(di->>'charField1',''),'Tanpa kategori') AS key,
           COALESCE(NULLIF(di->>'charField1',''),'Tanpa kategori') AS label,
           sum((di->>'totalPrice')::numeric)::float8 AS total,
           count(DISTINCT ai.id)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text,
         jsonb_array_elements(COALESCE(ai.raw->'detailItem','[]'::jsonb)) di
    WHERE ai.tanggal BETWEEN ${from} AND ${to} AND ai.raw IS NOT NULL ${scopeClause(sql, sc)}
    GROUP BY 1 ORDER BY sum((di->>'totalPrice')::numeric) DESC`;
  return {
    scope: sc.amOnly ? ("am" as const) : ("all" as const),
    range: { from, to },
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      total: Number(r.total),
      count: Number(r.count),
    })),
  };
}

// ── View #4: Per-Cabang Territory ─────────────────────────────────
export async function analyticsPerCabang(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const year = yearOf(to);
  const regionMap = await cabangRegionMap(sql);
  const rows = await sql`
    SELECT COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AS key,
           sum(ai.total)::float8 AS total, count(*)::int AS count,
           count(DISTINCT ai.customer_id)::int AS customers,
           count(DISTINCT mu.am_id)::int AS am_count,
           max(stc.target)::float8 AS target
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN sales_target_cabang stc ON stc.cabang = COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AND stc.year = ${year}
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY 1 ORDER BY sum(ai.total) DESC`;
  return {
    scope: sc.amOnly ? ("am" as const) : ("all" as const),
    range: { from, to },
    rows: rows.map((r) => {
      const key = String(r.key);
      const total = Number(r.total ?? 0);
      const target = r.target != null ? Number(r.target) : null;
      return {
        cabang: key,
        region: regionMap[key] ?? "OFFICE",
        total,
        count: Number(r.count ?? 0),
        customers: Number(r.customers ?? 0),
        am_count: Number(r.am_count ?? 0),
        target,
        achievement_pct: pct(total, target),
      };
    }),
  };
}

// ── View #5: Per-Customer Segment ─────────────────────────────────
// Full case reuse customersRevenue() (sudah lengkap: prioritas/dormant/YTD).
// Scope AM: daftar customer yang dilayani AM ybs.
export async function analyticsPerCustomer(from0?: string, to0?: string, scope?: DataScope) {
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  if (!isRestricted(sc)) {
    const full = await customersRevenue();
    return { scope: "all" as const, ...full };
  }
  const { from, to } = salesRange(from0, to0);
  const sql = db();
  const rows = await sql`
    SELECT ai.customer_id::text AS id,
           COALESCE(NULLIF(ac.name,''), 'Customer #' || ai.customer_id::text) AS name,
           sum(ai.total)::float8 AS total, count(*)::int AS invoices,
           max(ai.tanggal)::text AS last_date,
           (CURRENT_DATE - max(ai.tanggal))::int AS days_since
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total) DESC`;
  return {
    scope: "am" as const,
    range: { from, to },
    customers: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      total: Number(r.total),
      invoices: Number(r.invoices),
      last_date: r.last_date ? String(r.last_date) : null,
      days_since: r.days_since == null ? null : Number(r.days_since),
    })),
  };
}

// ── View #6: Trending ─────────────────────────────────────────────
// Tren harian revenue+orders untuk rentang, + anomaly sederhana (≥2σ, tanpa LLM).
export async function analyticsTrending(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const rows = await sql`
    SELECT ai.tanggal::text AS date, COALESCE(sum(ai.total),0)::float8 AS revenue, count(*)::int AS orders
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY ai.tanggal ORDER BY ai.tanggal`;
  const series = rows.map((r) => ({ date: String(r.date), revenue: Number(r.revenue), orders: Number(r.orders) }));
  // Anomali: |rev - mean| > 2σ.
  const vals = series.map((s) => s.revenue);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const variance = vals.length ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length : 0;
  const std = Math.sqrt(variance);
  const points = series.map((s) => ({ ...s, anomaly: std > 0 && Math.abs(s.revenue - mean) > 2 * std }));
  return {
    scope: sc.amOnly ? ("am" as const) : ("all" as const),
    range: { from, to },
    metric: "revenue" as const,
    mean: Math.round(mean),
    std: Math.round(std),
    points,
  };
}
