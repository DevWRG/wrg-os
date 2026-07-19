// F76 Executive Command Center (Director Dashboard) — lapisan agregasi read-only
// di atas sumber yang sudah ada. TIDAK ada tabel baru: semua view dikomposisi
// live dari repo teruji (F127 sales-analytics, F76 watchpoint, AR, customers,
// pipeline/deal, competitor). Scope row-level via x-user-id → resolveScope:
//   - COMMAND / OUTLET / KPI  → level direktur (full company)
//   - AM RADAR                → ikut scope (AM = data sendiri, HoD = cabang tim)
//
// 5 view MVP: command, am-radar, outlet-matrix, dormant-intel, kpi-baseline.
// (Growth Levers/LLM + Rotation/NPK menyusul — F66 NPK belum dibangun.)

import { db } from "../db.js";
import {
  reportSalesPerformance,
  customersRevenue,
  dormantCustomers,
} from "./sales.js";
import { analyticsPerAm } from "./sales-analytics.js";
import { getWatchBoard } from "./watchpoint.js";
import { getAging } from "./ar.js";
import { getPipeline } from "./deal.js";
import { listCompetitor } from "./competitor.js";
import { type DataScope } from "./access-scope.js";

export type Light = "green" | "yellow" | "red" | "na";

// Traffic light achievement: hijau ≥90% · kuning 75–90% · merah <75% (PRD §View 2).
export function light(pct: number | null | undefined): Light {
  if (pct == null) return "na";
  if (pct >= 90) return "green";
  if (pct >= 75) return "yellow";
  return "red";
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const ratioPct = (num: number, den: number): number | null =>
  den > 0 ? round1((num / den) * 100) : null;

// ── View #1: COMMAND — ringkasan eksekutif "apa yang perlu perhatian hari ini" ──
export async function execCommand(scope?: DataScope) {
  const [perf, board, aging, dormant, pipe] = await Promise.all([
    reportSalesPerformance(),
    getWatchBoard().catch(() => null),
    getAging().catch(() => null),
    dormantCustomers(60).catch(() => null),
    getPipeline(scope).catch(() => null),
  ]);

  const month = perf.periods.find((p) => p.key === "month");
  const year = perf.periods.find((p) => p.key === "year");

  // Red flags dari WatchPoint HoD — ratakan metric berstatus RED, prioritas pct terendah.
  const redFlags: {
    hod: string; metric: string; actual: number | null; target: number | null;
    unit: string; pct: number | null;
  }[] = [];
  for (const h of board?.hods ?? []) {
    for (const m of h.metrics) {
      if (m.status === "RED")
        redFlags.push({ hod: h.name, metric: m.label, actual: m.actual, target: m.target, unit: m.unit, pct: m.pct });
    }
  }
  redFlags.sort((a, b) => (a.pct ?? 9999) - (b.pct ?? 9999));

  // Opportunities: deal pipeline di stage Negosiasi (nilai terbesar) — F1 SPT.
  const negoStages = (pipe?.stages ?? []).filter((s) => /nego/i.test(s.stage));
  const opportunities = negoStages
    .flatMap((s) => s.deals.map((d) => ({ customer: d.customer_name, value: d.estimate_amount, am_id: d.am_name ?? d.am_id, stage: s.stage })))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3);

  const arOver90 = aging
    ? aging.invoices.filter((i) => i.days_overdue > 90).reduce((a, i) => a + i.amount, 0)
    : null;

  return {
    range: month ? { from: month.from, to: month.to } : null,
    revenue_mtd: month?.total ?? 0,
    target_mtd: month?.target.total ?? null,
    achievement_mtd_pct: month?.pct.total ?? null,
    revenue_ytd: year?.total ?? 0,
    target_ytd: year?.target.total ?? null,
    achievement_ytd_pct: year?.pct.total ?? null,
    delta_mom_pct: perf.mtd_vs_last.growth_pct,
    ar_total: aging?.total_outstanding ?? null,
    ar_over_90: arOver90,
    dormant_count: dormant?.summary.count ?? null,
    dormant_value: dormant?.summary.value_at_risk ?? null,
    red_flags: redFlags.slice(0, 5),
    red_flags_count: redFlags.length,
    opportunities,
  };
}

// ── View #2: AM RADAR — snapshot per-AM + traffic light (reuse F127 per-am) ──
export async function execAmRadar(scope?: DataScope) {
  const data = await analyticsPerAm(undefined, undefined, scope);
  const rows = data.rows.map((r) => ({ ...r, light: light(r.achievement_pct) }));
  const summary = {
    total: rows.length,
    green: rows.filter((r) => r.light === "green").length,
    yellow: rows.filter((r) => r.light === "yellow").length,
    red: rows.filter((r) => r.light === "red").length,
    na: rows.filter((r) => r.light === "na").length,
  };
  return { range: data.range, scope: data.scope, summary, rows };
}

// ── View #3: OUTLET MATRIX — kesehatan portfolio faskes + risiko konsentrasi ──
export async function execOutletMatrix() {
  const cr = await customersRevenue();
  const totalRev = cr.summary.revenue_total;
  const sorted = [...cr.customers].sort((a, b) => b.total - a.total);

  const top20 = sorted.slice(0, 20).map((c) => ({
    id: c.id, name: c.name, cabang: c.cabang, total: c.total,
    this_month: c.this_month, invoices: c.invoices, days_since: c.days_since,
    share_pct: ratioPct(c.total, totalRev),
  }));

  const top5Share = ratioPct(sorted.slice(0, 5).reduce((a, c) => a + c.total, 0), totalRev);
  const topShare = top20[0]?.share_pct ?? null;
  const concentration = {
    top_customer: top20[0]?.name ?? null,
    top_share_pct: topShare,
    top5_share_pct: top5Share,
    // Flag risiko konsentrasi: satu customer > 30% revenue (PRD §View 3).
    flag: topShare != null && topShare > 30,
  };

  const dormant = sorted
    .filter((c) => c.dormant)
    .slice(0, 20)
    .map((c) => ({ id: c.id, name: c.name, cabang: c.cabang, total: c.total, last_date: c.last_date, days_since: c.days_since }));

  return { summary: cr.summary, concentration, top_customers: top20, dormant };
}

// ── View #5: DORMANT INTEL — apa yang berubah minggu ini (customer intelligence) ──
export async function execDormantIntel() {
  const sql = db();
  const [newCust, reactivated, silent, competitor] = await Promise.all([
    // New customer: faktur PERTAMA dalam 7 hari terakhir.
    sql`
      SELECT ai.customer_id::text AS id,
        COALESCE(NULLIF(ac.name,''), 'Customer #' || ai.customer_id::text) AS name,
        min(ai.tanggal)::text AS first_date, count(*)::int AS invoices,
        sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS total
      FROM accurate_invoice ai LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
      WHERE ai.customer_id IS NOT NULL
      GROUP BY ai.customer_id, ac.name
      HAVING min(ai.tanggal) >= CURRENT_DATE - interval '7 days'
      ORDER BY total DESC LIMIT 20`,
    // Reaktivasi: order lagi setelah senyap > 60 hari (dalam 14 hari terakhir).
    sql`
      WITH ordered AS (
        SELECT customer_id, tanggal,
          lag(tanggal) OVER (PARTITION BY customer_id ORDER BY tanggal) AS prev
        FROM accurate_invoice WHERE customer_id IS NOT NULL
      )
      SELECT o.customer_id::text AS id,
        COALESCE(NULLIF(ac.name,''), 'Customer #' || o.customer_id::text) AS name,
        o.tanggal::text AS reactivated_date, (o.tanggal - o.prev)::int AS gap_days
      FROM ordered o LEFT JOIN accurate_customer ac ON ac.id = o.customer_id
      WHERE o.prev IS NOT NULL AND (o.tanggal - o.prev) > 60
        AND o.tanggal >= CURRENT_DATE - interval '14 days'
      ORDER BY o.tanggal DESC, gap_days DESC LIMIT 20`,
    // Suddenly silent: dulu rutin (≥3 faktur), kini senyap 30–60 hari (early churn).
    sql`
      WITH cust AS (
        SELECT customer_id, max(tanggal) AS last_date, count(*)::int AS invoices,
          (CURRENT_DATE - max(tanggal))::int AS days_since,
          sum(total - COALESCE(tax_amount,0))::float8 AS total
        FROM accurate_invoice WHERE customer_id IS NOT NULL GROUP BY customer_id
      )
      SELECT c.customer_id::text AS id,
        COALESCE(NULLIF(ac.name,''), 'Customer #' || c.customer_id::text) AS name,
        c.last_date::text AS last_date, c.days_since, c.total, c.invoices
      FROM cust c LEFT JOIN accurate_customer ac ON ac.id = c.customer_id
      WHERE c.days_since BETWEEN 30 AND 60 AND c.invoices >= 3
      ORDER BY c.total DESC LIMIT 20`,
    listCompetitor(undefined, 15).catch(() => []),
  ]);

  return {
    new_customers: newCust.map((r) => ({
      id: String(r.id), name: String(r.name), first_date: String(r.first_date),
      invoices: Number(r.invoices), total: Number(r.total),
    })),
    reactivated: reactivated.map((r) => ({
      id: String(r.id), name: String(r.name),
      reactivated_date: String(r.reactivated_date), gap_days: Number(r.gap_days),
    })),
    silent: silent.map((r) => ({
      id: String(r.id), name: String(r.name), last_date: String(r.last_date),
      days_since: Number(r.days_since), total: Number(r.total), invoices: Number(r.invoices),
    })),
    competitor_mentions: competitor.map((c) => ({
      id: c.id, tanggal: c.tanggal, vendor: c.vendor, produk: c.produk,
      customer_name: c.customer_name, am_id: c.am_id, konteks: c.konteks,
    })),
  };
}

// ── View #7: KPI BASELINE — subset KPI yang bisa dihitung dari data existing ──
// Catatan: ini subset yang traceable ke sumber live (F127/AR/customers/WatchPoint).
// 22 KPI penuh (SK & Blueprint §8) butuh input manual/F66 NPK → menyusul.
export interface KpiRow {
  name: string; formula: string; unit: "IDR" | "%" | "count";
  target: number | null; actual: number | null; status: Light; trend: number | null;
  lower_is_better?: boolean;
}

export async function execKpiBaseline() {
  const [perf, aging, dormant, cr, board] = await Promise.all([
    reportSalesPerformance(),
    getAging().catch(() => null),
    dormantCustomers(60).catch(() => null),
    customersRevenue(),
    getWatchBoard().catch(() => null),
  ]);

  const year = perf.periods.find((p) => p.key === "year");
  const month = perf.periods.find((p) => p.key === "month");
  const arTotal = aging?.total_outstanding ?? 0;
  const arOver90 = aging ? aging.invoices.filter((i) => i.days_overdue > 90).reduce((a, i) => a + i.amount, 0) : null;
  const redFlags = (board?.hods ?? []).reduce((n, h) => n + h.metrics.filter((m) => m.status === "RED").length, 0);
  const arOver90Ratio = arOver90 != null && arTotal > 0 ? ratioPct(arOver90, arTotal) : null;
  const dormantRatio = cr.summary.total_customers > 0 ? ratioPct(cr.summary.dormant, cr.summary.total_customers) : null;
  const activeRatio = cr.summary.total_customers > 0 ? ratioPct(cr.summary.active, cr.summary.total_customers) : null;

  // status untuk metrik "lebih rendah lebih baik" (AR, dormant): pakai ambang tetap.
  const lowerStatus = (v: number | null, warn: number, bad: number): Light =>
    v == null ? "na" : v >= bad ? "red" : v >= warn ? "yellow" : "green";

  const kpis: KpiRow[] = [
    { name: "Sales YTD vs Target", formula: "Σ revenue YTD ÷ target tahunan", unit: "%",
      target: 100, actual: year?.pct.total ?? null, status: light(year?.pct.total), trend: null },
    { name: "Sales MTD vs Target", formula: "Σ revenue bulan ini ÷ target bulanan", unit: "%",
      target: 100, actual: month?.pct.total ?? null, status: light(month?.pct.total), trend: perf.mtd_vs_last.growth_pct },
    { name: "Growth MoM", formula: "(MTD − bulan lalu) ÷ bulan lalu", unit: "%",
      target: 0, actual: perf.mtd_vs_last.growth_pct, trend: perf.mtd_vs_last.growth_pct,
      status: perf.mtd_vs_last.growth_pct == null ? "na" : perf.mtd_vs_last.growth_pct >= 0 ? "green" : "red" },
    { name: "Achievement East", formula: "revenue East YTD ÷ target East", unit: "%",
      target: 100, actual: year?.pct.east ?? null, status: light(year?.pct.east), trend: null },
    { name: "Achievement West", formula: "revenue West YTD ÷ target West", unit: "%",
      target: 100, actual: year?.pct.west ?? null, status: light(year?.pct.west), trend: null },
    { name: "AR Outstanding", formula: "Σ sisa tagihan (net)", unit: "IDR",
      target: null, actual: arTotal || null, status: "na", trend: null, lower_is_better: true },
    { name: "AR Overdue >90 hari", formula: "Σ tagihan telat >90 hari", unit: "IDR",
      target: 0, actual: arOver90, status: arOver90 == null ? "na" : arOver90 > 0 ? "red" : "green", trend: null, lower_is_better: true },
    { name: "Rasio AR >90 hari", formula: "AR >90 ÷ total AR", unit: "%",
      target: 0, actual: arOver90Ratio, status: lowerStatus(arOver90Ratio, 10, 25), trend: null, lower_is_better: true },
    { name: "Rasio Customer Aktif", formula: "customer aktif ÷ total customer", unit: "%",
      target: 100, actual: activeRatio, status: light(activeRatio), trend: null },
    { name: "Rasio Customer Dormant", formula: "dormant (>60 hari) ÷ total customer", unit: "%",
      target: 0, actual: dormantRatio, status: lowerStatus(dormantRatio, 20, 40), trend: null, lower_is_better: true },
    { name: "Customer Dormant (jumlah)", formula: "count customer tanpa order >60 hari", unit: "count",
      target: 0, actual: dormant?.summary.count ?? null, status: "na", trend: null, lower_is_better: true },
    { name: "WatchPoint Red Flags", formula: "count metric HoD status merah", unit: "count",
      target: 0, actual: redFlags, status: redFlags === 0 ? "green" : redFlags <= 3 ? "yellow" : "red", trend: null, lower_is_better: true },
  ];

  return { as_of: perf.as_of, count: kpis.length, note: "Subset KPI computable dari data live; 22 KPI penuh (SK) menyusul.", kpis };
}
