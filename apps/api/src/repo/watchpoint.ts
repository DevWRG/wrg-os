// F76 — WatchPoint HoD Dashboard (metric-based, DB-backed).
//
// Spec: PRD-Sales-Batch-3 §F76 + HOD-Prompt-Workflow §3 (brief Direktur Juni 2026).
// Tiap HoD punya daftar WatchPoint metric (Target vs Aktual) dengan threshold gate:
//   🟢 GREEN  : aktual ≥ target (attainment ≥ 100%)
//   🟡 YELLOW : 50% ≤ attainment < 100%
//   🔴 RED    : attainment < 50%
// Metric "lower is better" (AR overdue, churn, lead time) di-invert.
//
// Sumber aktual — TIDAK ADA angka hardcoded:
//   - source 'db'     → dihitung live dari Accurate mirror + sales_plan + ar_aging_mv
//   - source 'manual' → diambil dari tabel `watchpoint_metric` (diisi HoD). Bila
//     belum ada barisnya → actual NULL → status NA (jujur, bukan dummy).

import { db, isDbEnabled } from "../db.js";

export type WatchStatus = "GREEN" | "YELLOW" | "RED" | "NA";
export type WatchTrend = "improving" | "stable" | "declining";

export interface WatchMetric {
  key: string;
  label: string;
  target: number | null; // null = kualitatif (tanpa target numerik)
  actual: number | null;
  unit: string; // "Rp" | "%" | "kunjungan" | "customer" | "hari" | "site" | ""
  direction: "higher" | "lower";
  source: "db" | "manual";
  pct: number | null; // attainment %
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
}

export interface HodWatch {
  key: string;
  name: string;
  role: string;
  status: WatchStatus; // agregat: worst-of metric
  metrics: WatchMetric[];
}

export interface WatchBoard {
  source: "computed";
  generatedFor: string;
  asOf: string;
  hods: HodWatch[];
  meta: {
    gate: string;
    legend: Record<WatchStatus, string>;
    pending: string[];
  };
}

// ── Threshold engine ──────────────────────────────────────────────
function attainment(target: number | null, actual: number | null, dir: "higher" | "lower"): number | null {
  if (target === null || actual === null) return null;
  if (dir === "lower") {
    if (target === 0) return actual <= 0 ? 100 : 0; // mis. "0 churn"
    if (actual <= 0) return 100;
    return Math.min((target / actual) * 100, 999);
  }
  if (target === 0) return actual >= 0 ? 100 : 0;
  return (actual / target) * 100;
}

function gate(pct: number | null): WatchStatus {
  if (pct === null) return "NA";
  if (pct >= 100) return "GREEN";
  if (pct >= 50) return "YELLOW";
  return "RED";
}

function worst(metrics: WatchMetric[]): WatchStatus {
  if (metrics.some((m) => m.status === "RED")) return "RED";
  if (metrics.some((m) => m.status === "YELLOW")) return "YELLOW";
  if (metrics.some((m) => m.status === "GREEN")) return "GREEN";
  return "NA";
}

// ── DB derivations (Accurate mirror + AR + plan) ──────────────────
type Sql = ReturnType<typeof db>;

async function revenueThisMonth(sql: Sql, cabang: string[]): Promise<number> {
  const rows = await sql<{ v: number }[]>`
    SELECT COALESCE(sum(ai.total),0)::float8 AS v
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.tanggal >= date_trunc('month', CURRENT_DATE)
      AND mu.cabang = ANY(${cabang})`;
  return Number(rows[0]?.v ?? 0);
}

async function amCount(sql: Sql, cabang: string[]): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(DISTINCT acs.id)::int AS n
    FROM accurate_salesman acs
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE mu.cabang = ANY(${cabang})`;
  return Number(rows[0]?.n ?? 0);
}

async function arOver90(sql: Sql): Promise<number> {
  const rows = await sql<{ v: number }[]>`
    SELECT COALESCE(sum(amount),0)::float8 AS v FROM ar_aging_mv WHERE bucket = '>90'`;
  return Number(rows[0]?.v ?? 0);
}

async function noOrderOver(sql: Sql, days: number): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT customer_id FROM accurate_invoice
      GROUP BY customer_id HAVING max(tanggal) < CURRENT_DATE - ${days}::int
    ) q`;
  return Number(rows[0]?.n ?? 0);
}

async function churnRutin(sql: Sql, cabang: string[]): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT ai.customer_id
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE mu.cabang = ANY(${cabang})
      GROUP BY ai.customer_id
      HAVING count(*) >= 3 AND max(ai.tanggal) < CURRENT_DATE - 60
    ) q`;
  return Number(rows[0]?.n ?? 0);
}

async function visitsThisMonth(sql: Sql, cabang: string[]): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM sales_plan sp
    JOIN master_user mu ON mu.am_id = sp.am_id
    WHERE mu.cabang = ANY(${cabang})
      AND sp.tanggal >= date_trunc('month', CURRENT_DATE)`;
  return Number(rows[0]?.n ?? 0);
}

// ── Definisi metric per HoD (TANPA nilai aktual hardcoded) ────────
interface MetricDef {
  key: string;
  label: string;
  target: number | null; // null = kualitatif (aktual diisi via status_override)
  unit: string;
  direction: "higher" | "lower";
  trend: WatchTrend;
  compute?: (sql: Sql) => Promise<number>; // ada = source 'db'; tidak = 'manual'
}

interface HodDef {
  key: string;
  name: string;
  role: string;
  cabang: string[]; // demo mapping (ganti dgn AREA PER HOD.xlsx)
  metrics: MetricDef[];
}

const BIO = 1_000_000_000;
const JT = 1_000_000;

const HOD_DEFS: HodDef[] = [
  {
    key: "rocky", name: "Rocky", role: "Sales East", cabang: ["Surabaya", "Medan"],
    metrics: [
      { key: "revenue", label: "Revenue/bln", target: 2.5 * BIO, unit: "Rp", direction: "higher", trend: "improving", compute: (s) => revenueThisMonth(s, ["Surabaya", "Medan"]) },
      { key: "prod", label: "Produktivitas/AM", target: 500 * JT, unit: "Rp", direction: "higher", trend: "stable", compute: async (s) => { const r = await revenueThisMonth(s, ["Surabaya", "Medan"]); const n = await amCount(s, ["Surabaya", "Medan"]); return n ? r / n : 0; } },
      { key: "visits", label: "Kunjungan/bln", target: 48, unit: "kunjungan", direction: "higher", trend: "stable", compute: (s) => visitsThisMonth(s, ["Surabaya", "Medan"]) },
      { key: "newacct", label: "Akun baru/bln", target: 2, unit: "akun", direction: "higher", trend: "stable" },
      { key: "churn", label: "Churn RUTIN", target: 0, unit: "customer", direction: "lower", trend: "improving", compute: (s) => churnRutin(s, ["Surabaya", "Medan"]) },
    ],
  },
  {
    key: "yogi", name: "Yogi", role: "Sales West", cabang: ["Bandung", "Jakarta"],
    metrics: [
      { key: "revenue", label: "Revenue/bln", target: 2.5 * BIO, unit: "Rp", direction: "higher", trend: "stable", compute: (s) => revenueThisMonth(s, ["Bandung", "Jakarta"]) },
      { key: "prod", label: "Produktivitas/AM", target: 500 * JT, unit: "Rp", direction: "higher", trend: "stable", compute: async (s) => { const r = await revenueThisMonth(s, ["Bandung", "Jakarta"]); const n = await amCount(s, ["Bandung", "Jakarta"]); return n ? r / n : 0; } },
      { key: "visits", label: "Kunjungan/bln", target: 48, unit: "kunjungan", direction: "higher", trend: "stable", compute: (s) => visitsThisMonth(s, ["Bandung", "Jakarta"]) },
      { key: "newacct", label: "Akun baru/bln", target: 2, unit: "akun", direction: "higher", trend: "declining" },
      { key: "churn", label: "Churn RUTIN", target: 0, unit: "customer", direction: "lower", trend: "stable", compute: (s) => churnRutin(s, ["Bandung", "Jakarta"]) },
    ],
  },
  {
    key: "mufid", name: "Mufid", role: "Business IVD", cabang: [],
    metrics: [
      { key: "clia", label: "Site CLIA ≥800 tes/bln", target: 3, unit: "site", direction: "higher", trend: "stable" },
      { key: "fia", label: "FIA customer", target: 20, unit: "customer", direction: "higher", trend: "stable" },
      { key: "jv", label: "JV principal baru", target: 1, unit: "JV", direction: "higher", trend: "stable" },
      { key: "xsell", label: "Cross-sell reguler→CLIA", target: 2, unit: "deal", direction: "higher", trend: "stable" },
      { key: "moq", label: "MOQ Snibe diputus", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "arman", name: "Arman", role: "Business Medical & HD", cabang: [],
    metrics: [
      { key: "hd", label: "Site HD maju 1 milestone", target: 1, unit: "site", direction: "higher", trend: "stable" },
      { key: "okupansi", label: "Okupansi tindakan/mesin/bln", target: 48, unit: "tindakan", direction: "higher", trend: "stable" },
      { key: "coloc", label: "Co-location CLIA (Permenkes 3/2023)", target: 3, unit: "site", direction: "higher", trend: "stable" },
      { key: "jv", label: "JV principal (Edan/Miki/Oneject)", target: 1, unit: "JV", direction: "higher", trend: "stable" },
      { key: "xsell", label: "Cross-sell", target: 2, unit: "deal", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "pakMuhid", name: "Pak Muhid", role: "Aftersales", cabang: [],
    metrics: [
      { key: "uptime", label: "Uptime/analyzer", target: 95, unit: "%", direction: "higher", trend: "stable" },
      { key: "rar", label: "RaR/cabang", target: 202 * JT, unit: "Rp", direction: "higher", trend: "stable" },
      { key: "install", label: "Lead time install", target: 7, unit: "hari", direction: "lower", trend: "stable" },
      { key: "noorder", label: "Customer no-order >60 hari", target: 0, unit: "customer", direction: "lower", trend: "stable", compute: (s) => noOrderOver(s, 60) },
    ],
  },
  {
    key: "ika", name: "Ika", role: "Finance & SC", cabang: [],
    metrics: [
      { key: "ar90", label: "AR overdue >90 hari", target: 500 * JT, unit: "Rp", direction: "lower", trend: "stable", compute: (s) => arOver90(s) },
      { key: "fillrate", label: "Fill rate", target: 95, unit: "%", direction: "higher", trend: "stable" },
      { key: "refi", label: "Milestone refinancing", target: 1, unit: "milestone", direction: "higher", trend: "stable" },
      { key: "runway", label: "Cash runway mingguan", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "fafa", name: "Fafa", role: "Accounting & Tax", cabang: [],
    metrics: [
      { key: "close", label: "Close cycle", target: 10, unit: "hari", direction: "lower", trend: "stable" },
      { key: "opex", label: "OPEX ratio", target: 35, unit: "%", direction: "lower", trend: "stable" },
      { key: "revstream", label: "Revenue-by-stream report", target: null, unit: "", direction: "higher", trend: "stable" },
      { key: "gp", label: "GP per stream report", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "husni", name: "Husni", role: "BD & GA ⭐ KEYSTONE", cabang: [],
    metrics: [
      { key: "spine", label: "Data Spine MVP LIVE", target: null, unit: "", direction: "higher", trend: "improving" },
      { key: "orch", label: "Orchestrating database", target: null, unit: "", direction: "higher", trend: "improving" },
      { key: "dash", label: "Dashboard LIVE", target: null, unit: "", direction: "higher", trend: "improving" },
    ],
  },
];

const LEGEND: Record<WatchStatus, string> = {
  GREEN: "≥ target",
  YELLOW: "50–99% target",
  RED: "< 50% target",
  NA: "Belum ada data",
};

const PENDING: string[] = [
  "Metric manual (JV, CLIA, uptime, refinancing, dll) diisi via tabel watchpoint_metric — kosong → N/A",
  "Mapping HoD→cabang pakai data dummy; ganti dgn AREA PER HOD.xlsx (62 AM-territory)",
  "3 leverage AI-suggest per HoD (F85) menyusul",
];

// Nilai manual dari DB: key `${hod_key}:${metric_key}`.
interface ManualRow { actual: number | null; status_override: string | null; note: string | null }

async function loadManual(sql: Sql): Promise<Map<string, ManualRow>> {
  const rows = await sql<{ hod_key: string; metric_key: string; actual: number | null; status_override: string | null; note: string | null }[]>`
    SELECT hod_key, metric_key, actual, status_override, note FROM watchpoint_metric`;
  const m = new Map<string, ManualRow>();
  for (const r of rows) m.set(`${r.hod_key}:${r.metric_key}`, { actual: r.actual === null ? null : Number(r.actual), status_override: r.status_override, note: r.note });
  return m;
}

const VALID_STATUS = new Set<WatchStatus>(["GREEN", "YELLOW", "RED", "NA"]);

async function buildMetric(
  sql: Sql | null,
  hodKey: string,
  d: MetricDef,
  manual: Map<string, ManualRow>,
): Promise<WatchMetric> {
  let actual: number | null;
  let source: "db" | "manual";
  let note: string | undefined;
  let override: WatchStatus | undefined;

  if (d.compute && sql) {
    source = "db";
    try {
      actual = await d.compute(sql);
    } catch {
      actual = null;
      source = "manual";
    }
  } else {
    source = "manual";
    const row = manual.get(`${hodKey}:${d.key}`);
    actual = row?.actual ?? null;
    note = row?.note ?? undefined;
    if (row?.status_override && VALID_STATUS.has(row.status_override as WatchStatus)) {
      override = row.status_override as WatchStatus;
    }
  }

  const pct = attainment(d.target, actual, d.direction);
  const status = d.target === null ? override ?? "NA" : gate(pct);
  return {
    key: d.key, label: d.label, target: d.target, actual, unit: d.unit,
    direction: d.direction, source, pct, status, trend: d.trend, note,
  };
}

/** Papan WatchPoint per HoD — computed metric dari DB, manual dari watchpoint_metric. */
export async function getWatchBoard(): Promise<WatchBoard> {
  const sql = isDbEnabled() ? db() : null;
  const manual = sql ? await loadManual(sql) : new Map<string, ManualRow>();
  const hods: HodWatch[] = [];
  for (const h of HOD_DEFS) {
    const metrics = await Promise.all(h.metrics.map((m) => buildMetric(sql, h.key, m, manual)));
    hods.push({ key: h.key, name: h.name, role: h.role, status: worst(metrics), metrics });
  }
  return {
    source: "computed",
    generatedFor: "Sprint B1! / W25 (2026-06-22 — 2026-06-28)",
    asOf: new Date().toISOString(),
    hods,
    meta: {
      gate: "🟢 ≥ target · 🟡 50–99% · 🔴 < 50%",
      legend: LEGEND,
      pending: PENDING,
    },
  };
}
