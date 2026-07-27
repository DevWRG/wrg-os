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
import { isRestricted, scopeAccurateClause, type DataScope } from "./access-scope.js";

const yearOf = (to: string): number => Number(to.slice(0, 4));
const pct = (num: number, den: number | null | undefined): number | null =>
  den && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

// Klausa scope row-level (query yang join accurate_salesman→master_user):
//   AM  → AND mu.am_id = <amId>
//   HoD → AND cabang ∈ cabangScope (tim HoD)
//   lainnya → kosong (lihat semua)
// Definisinya tinggal satu di access-scope.ts (dipakai juga oleh AR & Visits) —
// dulu aturan ini dikopi per-repo, gampang lepas sinkron.
const scopeClause = scopeAccurateClause;

// ── View #1: Executive Overview ───────────────────────────────────
export async function analyticsOverview(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };

  if (isRestricted(sc)) {
    // Overview ber-scope (AM = data sendiri; HoD = cabang tim). Shape "am".
    const sql = db();
    const scl = scopeClause(sql, sc);
    const [kpi] = await sql`
      SELECT COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS revenue, count(*)::int AS orders,
             count(DISTINCT ai.customer_id)::int AS customers
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scl}`;
    const trend = await sql`
      SELECT ai.tanggal::text AS date, COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS revenue, count(*)::int AS orders
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
           sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total, count(*)::int AS count,
           max(sta.target)::float8 AS target
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN sales_target_am sta ON sta.am_id = mu.am_id AND sta.year = ${year}
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY mu.am_id
    ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC NULLS LAST`;

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
  // Revenue per-produk = netto (total−PPN) faktur di-ALOKASIKAN proporsional ke
  // tiap baris (porsi nilai baris) → Σ per faktur = netto faktur → rekonsiliasi
  // persis ke revenue level-faktur. (lihat analyticsPerProduk / analyticsPerPengadaan)
  const perProduk = await sql`
    WITH inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS inv_net
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id = ${amId}
    ),
    line AS (
      SELECT aii.item_id, aii.qty, inv.inv_net, GREATEST(aii.total,0) AS w,
             sum(GREATEST(aii.total,0)) OVER (PARTITION BY aii.invoice_id) AS wsum,
             count(*) OVER (PARTITION BY aii.invoice_id) AS cnt
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    )
    SELECT l.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), 'Item #' || l.item_id::text) AS label,
           sum(CASE WHEN l.wsum > 0 THEN l.inv_net * l.w / l.wsum ELSE l.inv_net / l.cnt END)::float8 AS total,
           sum(l.qty)::float8 AS qty
    FROM line l LEFT JOIN accurate_item it ON it.id = l.item_id
    GROUP BY l.item_id, it.name ORDER BY total DESC LIMIT 20`;
  const perCustomer = await sql`
    SELECT ai.customer_id::text AS key,
           COALESCE(NULLIF(ac.name,''), 'Customer #' || ai.customer_id::text) AS label,
           sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total, count(*)::int AS count
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id = ${amId}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC`;
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
  // Revenue = netto (total−PPN) faktur di-ALOKASIKAN proporsional ke tiap baris
  // (porsi nilai baris totalPrice) → Σ per faktur = netto faktur → grand total
  // rekonsiliasi PERSIS ke Total Revenue level-faktur (pola sama Per-Pengadaan).
  const rows = await sql`
    WITH inv AS (
      SELECT ai.id, ai.customer_id, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS inv_net
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    ),
    line AS (
      SELECT aii.item_id, aii.qty, inv.inv_net, inv.customer_id,
             aii.raw->'item'->>'name' AS raw_name, GREATEST(aii.total,0) AS w,
             sum(GREATEST(aii.total,0)) OVER (PARTITION BY aii.invoice_id) AS wsum,
             count(*) OVER (PARTITION BY aii.invoice_id) AS cnt
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    )
    SELECT l.item_id::text AS key,
           COALESCE(NULLIF(it.name,''), NULLIF(max(l.raw_name),''), 'Item #' || l.item_id::text) AS label,
           NULLIF(max(it.category),'') AS category,
           NULLIF(max(it.unit),'') AS satuan,
           max(it.quantity)::float8 AS stock_on_hand,
           sum(CASE WHEN l.wsum > 0 THEN l.inv_net * l.w / l.wsum ELSE l.inv_net / l.cnt END)::float8 AS total,
           sum(l.qty)::float8 AS unit_sold,
           count(DISTINCT l.customer_id)::int AS customer_count
    FROM line l LEFT JOIN accurate_item it ON it.id = l.item_id
    GROUP BY l.item_id, it.name ORDER BY total DESC LIMIT 200`;
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

// ── View: Per-Pengadaan (kategori penjualan REGULAR/KSO/RUTIN/PL/ECAT) ──
// Kategori = custom field Accurate level baris: detailItem[].charField1.
// Dikelompokkan HANYA per kategori DASAR (tanpa label gabungan "A + B").
// Faktur campur di-ALOKASIKAN proporsional: revenue faktur (netto = total−PPN)
// dibagi ke tiap kategori sesuai porsi nilai baris-nya (totalPrice). Karena tiap
// faktur teralokasi utuh (Σ porsi = 1), grand total REKONSILIASI PERSIS ke Total
// Revenue. Faktur tanpa raw/charField1 → "Tanpa kategori". count = jumlah faktur
// yg menyentuh kategori (faktur campur terhitung di >1 kategori). Scope AM/HoD.
export async function analyticsPerPengadaan(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const rows = await sql`
    WITH inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS inv_total, ai.raw
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    ),
    cat AS (  -- per faktur × kategori dasar; bobot = Σ totalPrice baris (>=0)
      SELECT inv.id, inv.inv_total,
             COALESCE(NULLIF(d.val->>'charField1',''),'Tanpa kategori') AS kategori,
             COALESCE(sum(GREATEST((d.val->>'totalPrice')::numeric, 0)), 0)::float8 AS w
      FROM inv
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inv.raw->'detailItem','[]'::jsonb)) AS d(val) ON true
      GROUP BY inv.id, inv.inv_total, COALESCE(NULLIF(d.val->>'charField1',''),'Tanpa kategori')
    ),
    share AS (
      SELECT id, inv_total, kategori, w,
             sum(w) OVER (PARTITION BY id) AS wsum,
             count(*) OVER (PARTITION BY id) AS cnt
      FROM cat
    )
    SELECT kategori AS key, kategori AS label,
           sum(CASE WHEN wsum > 0 THEN inv_total * w / wsum ELSE inv_total / cnt END)::float8 AS total,
           count(DISTINCT id)::int AS count
    FROM share GROUP BY kategori ORDER BY total DESC`;
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
           sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total, count(*)::int AS count,
           count(DISTINCT ai.customer_id)::int AS customers,
           count(DISTINCT mu.am_id)::int AS am_count,
           max(stc.target)::float8 AS target
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN sales_target_cabang stc ON stc.cabang = COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''), 'Tanpa cabang') AND stc.year = ${year}
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY 1 ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC`;
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
           sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total, count(*)::int AS invoices,
           max(ai.tanggal)::text AS last_date,
           (CURRENT_DATE - max(ai.tanggal))::int AS days_since
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeClause(sql, sc)}
    GROUP BY ai.customer_id, ac.name ORDER BY sum(ai.total - COALESCE(ai.tax_amount,0)) DESC`;
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

// ── Kinerja Saya: AR Aging ber-scope ──────────────────────────────
// AR aging piutang milik AM/HoD login (bukan lintas-tim). Basis = ar_aging_mv
// (sumber bucket/hari-lewat, konvensi current/1-30/31-60/61-90/90+), di-JOIN ke
// accurate_invoice utk outstanding hidup + salesman → master_user (agar scopeClause
// AM/HoD bisa memfilter). Outstanding = accurate_invoice.outstanding, yaitu
// primeOwing+taxOwing (net, sesuai pola AR existing; lihat accurateSync.ts) dgn
// fallback ar_aging_mv.amount bila baris belum ter-mirror. Baris tanpa salesman
// otomatis tersaring saat scope AM/HoD (mu.am_id NULL). Number() semua.
export type ArPriority = "KRITIS" | "TINGGI" | "SEDANG" | "RENDAH";
const AR_BUCKET_LABEL: Record<string, string> = {
  current: "Belum jatuh tempo",
  "1-30": "1-30 hari",
  "31-60": "31-60 hari",
  "61-90": "61-90 hari",
  "90+": ">90 hari",
};
const AR_BUCKET_ORDER = ["current", "1-30", "31-60", "61-90", "90+"];
function arPriorityOf(b31_60: number, b61_90: number, b90plus: number): ArPriority {
  if (b90plus > 0) return "KRITIS";
  if (b61_90 > 0) return "TINGGI";
  if (b31_60 > 0) return "SEDANG";
  return "RENDAH";
}

export async function getMyArAging(scope?: DataScope, from0?: string, to0?: string) {
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const scl = scopeClause(sql, sc);
  // Filter tanggal opsional (dipakai bila from+to lengkap) — AR default snapshot.
  const rangeOk = !!(from0 && to0 && /^\d{4}-\d{2}-\d{2}$/.test(from0) && /^\d{4}-\d{2}-\d{2}$/.test(to0));
  const dateClause = rangeOk ? sql`AND ai.tanggal BETWEEN ${from0} AND ${to0}` : sql``;
  const rows = await sql`
    SELECT m.customer_id::text AS customer_id,
           COALESCE(NULLIF(ac.name,''), NULLIF(m.customer_name,''), 'Customer #' || m.customer_id::text) AS customer_name,
           m.invoice_no, m.bucket, m.days_overdue::int AS days_overdue,
           COALESCE(ai.outstanding, m.amount)::float8 AS amount,
           NULLIF(mu.cabang,'') AS cabang,
           COALESCE(NULLIF(mu.nama,''), NULLIF(ai.salesman_name,'')) AS am
    FROM ar_aging_mv m
    LEFT JOIN accurate_invoice ai ON ai.number = m.invoice_no AND ai.customer_id::text = m.customer_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE COALESCE(ai.outstanding, m.amount) > 0 ${scl} ${dateClause}`;

  // Agregasi bucket + per-customer di JS (pola getAging).
  const bmap = new Map<string, { count: number; total: number }>();
  const cmap = new Map<string, {
    id: string; name: string; cabang: string | null; am: string | null;
    total: number; invoices: number; max_overdue: number;
    b31_60: number; b61_90: number; b90plus: number;
  }>();
  let totalOutstanding = 0;
  let overdueOutstanding = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    const bucket = String(r.bucket);
    const overdue = Number(r.days_overdue);
    totalOutstanding += amt;
    if (bucket !== "current") overdueOutstanding += amt;
    const b = bmap.get(bucket) ?? { count: 0, total: 0 };
    b.count += 1; b.total += amt;
    bmap.set(bucket, b);
    const cid = String(r.customer_id);
    const c = cmap.get(cid) ?? {
      id: cid, name: String(r.customer_name), cabang: r.cabang ? String(r.cabang) : null,
      am: r.am ? String(r.am) : null, total: 0, invoices: 0, max_overdue: 0,
      b31_60: 0, b61_90: 0, b90plus: 0,
    };
    c.total += amt; c.invoices += 1; c.max_overdue = Math.max(c.max_overdue, overdue);
    if (bucket === "31-60") c.b31_60 += amt;
    else if (bucket === "61-90") c.b61_90 += amt;
    else if (bucket === "90+") c.b90plus += amt;
    cmap.set(cid, c);
  }

  const buckets = AR_BUCKET_ORDER.map((b) => ({
    bucket: b,
    label: AR_BUCKET_LABEL[b] ?? b,
    count: bmap.get(b)?.count ?? 0,
    total: Number(bmap.get(b)?.total ?? 0),
  }));
  const top_customers = [...cmap.values()]
    .map((c) => ({
      id: c.id, name: c.name, cabang: c.cabang, am: c.am,
      total: Number(c.total), invoices: Number(c.invoices), max_overdue: Number(c.max_overdue),
      priority: arPriorityOf(c.b31_60, c.b61_90, c.b90plus),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return {
    scope: sc.amOnly ? ("am" as const) : (sc.cabangScope && sc.cabangScope.length ? ("hod" as const) : ("all" as const)),
    range: rangeOk ? { from: from0!, to: to0! } : null,
    total_outstanding: Number(totalOutstanding),
    overdue_outstanding: Number(overdueOutstanding),
    total_invoices: rows.length,
    total_customers: cmap.size,
    buckets,
    top_customers,
  };
}

// ── View #6: Trending ─────────────────────────────────────────────
// Tren harian revenue+orders untuk rentang, + anomaly sederhana (≥2σ, tanpa LLM).
export async function analyticsTrending(from0?: string, to0?: string, scope?: DataScope) {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const sql = db();
  const rows = await sql`
    SELECT ai.tanggal::text AS date, COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS revenue, count(*)::int AS orders
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
