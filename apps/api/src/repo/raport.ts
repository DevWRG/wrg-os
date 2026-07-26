// HR Raport 360 — scorecard per karyawan (MVP). Menggabungkan banyak sumber yang
// ter-kunci pada DUA model karyawan: master_user.am_id (plan/report, cuti, revenue,
// AR, coaching) dan employee.id slug (RACI/OKR/KPI/BSC), dijembatani employee.am_id.
//
// Skor komposit (bobot default, dim kosong direnormalisasi). Absensi = PROXY
// (cuti + hari aktif) karena tak ada tabel presensi. Pola/rekap/resume = konteks
// group-level (bukan skor per-orang). Semua dihitung on-the-fly (tanpa migrasi).

import { db } from "../db.js";
import { reportPerOrang, reportCompliance, type OrangRow, type ComplianceRow } from "./plandash.js";
import { getEmployee } from "./employee-spine.js";
import { listLeave } from "./leave.js";

// ── Periode (WIB): kuartal (YYYY-Q1..4), semester (YYYY-H1/H2), tahunan (YYYY),
// atau bulanan (YYYY-MM). months[] = daftar 'YYYY-MM' penyusun (utk agregasi KPI
// kpi_measurement yg per-bulan). Default = kuartal berjalan. ──
const PAD = (n: number) => String(n).padStart(2, "0");
function periodBounds(period?: string): { key: string; label: string; from: string; to: string; months: string[] } {
  const build = (y: number, m1: number, m2: number, key: string, label: string) => {
    const months: string[] = [];
    for (let m = m1; m <= m2; m++) months.push(`${y}-${PAD(m)}`);
    return {
      key, label,
      from: `${y}-${PAD(m1)}-01`,
      to: `${y}-${PAD(m2)}-${PAD(new Date(Date.UTC(y, m2, 0)).getUTCDate())}`,
      months,
    };
  };
  const p = (period ?? "").trim();
  let mm = p.match(/^(\d{4})-Q([1-4])$/i);
  if (mm) { const y = +mm[1], q = +mm[2]; return build(y, (q - 1) * 3 + 1, q * 3, `${y}-Q${q}`, `Kuartal ${q} ${y}`); }
  mm = p.match(/^(\d{4})-H([1-2])$/i);
  if (mm) { const y = +mm[1], h = +mm[2]; return build(y, h === 1 ? 1 : 7, h === 1 ? 6 : 12, `${y}-H${h}`, `Semester ${h} ${y}`); }
  mm = p.match(/^(\d{4})-(\d{2})$/);
  if (mm) { const y = +mm[1], m = +mm[2]; if (m >= 1 && m <= 12) return build(y, m, m, `${y}-${PAD(m)}`, `${PAD(m)}/${y}`); }
  mm = p.match(/^(\d{4})$/);
  if (mm) { const y = +mm[1]; return build(y, 1, 12, `${y}`, `Tahun ${y}`); }
  const w = new Date(Date.now() + 7 * 3600 * 1000); // default: kuartal berjalan
  const y = w.getUTCFullYear(), q = Math.ceil((w.getUTCMonth() + 1) / 3);
  return build(y, (q - 1) * 3 + 1, q * 3, `${y}-Q${q}`, `Kuartal ${q} ${y}`);
}

// ── Bobot komposit (default; iterasi berikutnya = konfigurasi) ──
export const RAPORT_WEIGHTS = {
  am: { bsc: 30, compliance: 20, revenue: 20, ar: 10, absensi: 10, coaching: 10 },
  non_am: { bsc: 40, compliance: 30, absensi: 15, coaching: 15 },
} as const;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const isAmRole = (role: unknown) => /^am$/i.test(String(role ?? "").trim());

export interface ScorePart { key: string; label: string; score: number | null; weight: number; eff_weight: number }

// Komposit atas sub-skor yang ADA (non-null). Bobot direnormalisasi ke dim yang ada.
function compose(parts: { key: string; label: string; score: number | null; weight: number }[]): {
  overall: number | null;
  parts: ScorePart[];
} {
  const present = parts.filter((p) => p.score != null && Number.isFinite(p.score));
  const wsum = present.reduce((a, p) => a + p.weight, 0);
  let overall: number | null = null;
  if (present.length && wsum > 0) {
    overall = Math.round(present.reduce((a, p) => a + (p.weight / wsum) * (p.score as number), 0));
  }
  return {
    overall,
    parts: parts.map((p) => ({
      key: p.key,
      label: p.label,
      score: p.score != null && Number.isFinite(p.score) ? Math.round(p.score) : null,
      weight: p.weight,
      eff_weight: p.score != null && Number.isFinite(p.score) && wsum > 0 ? Math.round((p.weight / wsum) * 100) : 0,
    })),
  };
}

// Port F119 computeScore (server-side) — skor BSC tertimbang, cap 120%, renormalisasi
// bobot atas perspektif ber-KPI. inputs = achievement_pct per kpi_id (default 100).
function bscScore(
  kpi: { id: string; perspective: string | null }[],
  weights: Record<string, number>,
  inputs: Record<string, number>,
): { score: number; perspScore: Record<string, number> } | null {
  const byP: Record<string, string[]> = {};
  for (const k of kpi) if (k.perspective) (byP[k.perspective] ??= []).push(k.id);
  const active = Object.keys(byP);
  if (!active.length) return null;
  const perspScore: Record<string, number> = {};
  for (const p of active) {
    const vals = byP[p].map((id) => Math.min(120, inputs[id] ?? 100));
    perspScore[p] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const wsum = active.reduce((a, p) => a + (weights[p] || 0), 0);
  let score = 0;
  for (const p of active) score += (wsum > 0 ? (weights[p] || 0) / wsum : 1 / active.length) * perspScore[p];
  return { score: Math.round(score), perspScore };
}

const ratingOf = (s: number | null): string =>
  s == null ? "—" : s >= 110 ? "Istimewa" : s >= 95 ? "Sesuai Target" : s >= 80 ? "Perlu Perhatian" : "Perlu Perbaikan";

// ── Sub-skor helper ──
const complianceScore = (c?: ComplianceRow): number | null =>
  c && c.expected > 0 && c.compliance_rate != null ? clamp(c.compliance_rate) : null;

// Absensi proxy: hari aktif / hari-kerja diharapkan (dari compliance.expected). Cap 100.
const absensiScore = (o?: OrangRow, c?: ComplianceRow): number | null => {
  const expected = c?.expected ?? 0;
  if (!o || expected <= 0) return null;
  return clamp((o.active_days / expected) * 100);
};

const revenueScore = (revenue: number, monthlyTarget: number | null): number | null =>
  monthlyTarget && monthlyTarget > 0 ? clamp((revenue / monthlyTarget) * 100, 0, 120) : null;

// AR "collection health": makin kecil outstanding relatif revenue, makin baik.
const arScore = (outstanding: number, revenue: number): number | null => {
  const base = outstanding + revenue;
  if (base <= 0) return null; // tak ada aktivitas AR/revenue → tak dinilai
  return clamp((revenue / base) * 100);
};

// ── Fase 2: klasifikasi item (heuristik teks, TANPA AI) ──
const ITEM_CATEGORIES: { key: string; label: string; kw: string[] }[] = [
  { key: "atk", label: "ATK / Stok", kw: ["atk", "stok", "alat tulis", "stationery", "tinta", "kertas"] },
  { key: "bank", label: "Perbankan / Materai", kw: ["bank", "mandiri", "bca", "jatim", "materai", "transfer", "setor", "rekening", "giro"] },
  { key: "it", label: "IT / Servis / Telkom", kw: ["printer", "komputer", "laptop", "servis", "telkom", "jaringan", " lan", "warp", "internet", "wifi", "cctv", " it "] },
  { key: "dana", label: "Dana Operasional", kw: ["dana", "operasional", "pengajuan", " acc", "reimburse", " kas", "ops "] },
  { key: "adm", label: "Konsumsi / Umum / Adm", kw: ["konsumsi", "meeting", "ttd", "dokumen", "administrasi", " adm", "surat", "rapat", "ruang", "tamu"] },
  { key: "kendaraan", label: "Kendaraan", kw: ["kendaraan", "mobil", "motor", "stnk", "bbm", "bensin", " km ", "pajak kendaraan"] },
];
function categorize(text: string): { key: string; label: string } {
  const t = ` ${text.toLowerCase()} `;
  for (const c of ITEM_CATEGORIES) if (c.kw.some((k) => t.includes(k))) return { key: c.key, label: c.label };
  return { key: "lain", label: "Lainnya" };
}
type ItemKind = "ok" | "fail" | "external" | "unknown";
function classifyStatus(status: string, result: string): { key: string; kind: ItemKind } {
  const s = (status || "").toLowerCase();
  const r = (result || "").toLowerCase();
  const waiting = /nunggu|menunggu|tunggu|pending|belum ada balas|balasan|pihak lain|telkom|cabang|vendor|supplier/.test(r);
  if (s === "matched") return { key: "berhasil", kind: "ok" };
  if (/parsial|sebagian|terjadwal|jadwal|dijadwal/.test(r)) return { key: "parsial", kind: "ok" };
  if (/\bacc\b|approval|disetujui|di-acc/.test(r)) return { key: "acc", kind: "ok" };
  if (waiting) return { key: "menunggu", kind: "external" };
  if (/belum|gagal|batal|tidak jadi|tertunda/.test(r) || s === "unmatched" || s === "ambiguous") return { key: "belum", kind: "fail" };
  return { key: "lain", kind: "unknown" };
}
const shortWait = (result: string): string => {
  const m = (result || "").toLowerCase().match(/n?unggu\s+([a-z]{2,}(?:\s+[a-z]{2,})?)/);
  return m ? `nunggu ${m[1].trim()}` : "menunggu";
};
const STATUS_ORDER: { key: string; label: string; color: string }[] = [
  { key: "berhasil", label: "Berhasil", color: "var(--chart-1)" },
  { key: "belum", label: "Belum jalan", color: "var(--chart-3)" },
  { key: "menunggu", label: "Menunggu (eksternal)", color: "var(--chart-2)" },
  { key: "lain", label: "Tanpa status jelas", color: "var(--muted-foreground)" },
  { key: "parsial", label: "Parsial / terjadwal", color: "var(--chart-4)" },
  { key: "acc", label: "ACC / proses", color: "var(--chart-5)" },
];

// ── Batched maps (untuk list, hindari N+1) ──
interface Maps {
  orang: Map<string, OrangRow>;
  compliance: Map<string, ComplianceRow>;
  revenue: Map<string, { revenue: number; invoices: number; target: number | null }>;
  ar: Map<string, { outstanding: number; invoices: number }>;
  coaching: Map<string, { period: string | null; score: number | null }>;
  leave: Map<string, { days: number; events: number }>;
  bsc: Map<string, { score: number; measured: number }>; // by am_id (via employee.am_id)
}

async function collectMaps(from: string, to: string, months: string[]): Promise<Maps> {
  const sql = db();
  const year = Number(to.slice(0, 4));

  const [orangRows, comp] = await Promise.all([reportPerOrang(from, to), reportCompliance(from, to)]);
  const orang = new Map(orangRows.map((r) => [r.am_id, r]));
  const compliance = new Map(comp.rows.map((r) => [r.am_id, r]));

  const [revRows, arRows, coachRows, leaveRows, bscRows, weightRows] = await Promise.all([
    sql`
      SELECT mu.am_id, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS revenue, count(*)::int AS invoices,
             max(sta.target)::float8 AS target
      FROM accurate_invoice ai
      JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      LEFT JOIN sales_target_am sta ON sta.am_id = mu.am_id AND sta.year = ${year}
      WHERE ai.tanggal BETWEEN ${from} AND ${to}
      GROUP BY mu.am_id
    `,
    sql`
      SELECT mu.am_id, COALESCE(sum(ai.total),0)::float8 AS outstanding, count(*)::int AS invoices
      FROM accurate_invoice ai
      JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.status = 'OPEN'
      GROUP BY mu.am_id
    `,
    sql`
      SELECT DISTINCT ON (am_id) am_id, period, score::float8 AS score
      FROM coaching_note ORDER BY am_id, created_at DESC
    `,
    sql`
      SELECT am_id,
             COALESCE(sum(GREATEST(0, (LEAST(end_date, ${to}::date) - GREATEST(start_date, ${from}::date)) + 1)),0)::int AS days,
             count(*)::int AS events
      FROM user_leave WHERE start_date <= ${to}::date AND end_date >= ${from}::date
      GROUP BY am_id
    `,
    sql`
      SELECT e.am_id, k.id::text AS kpi_id, k.perspective, e.dept, avg(m.achievement_pct)::float8 AS achievement_pct
      FROM employee e
      JOIN kpi k ON k.employee_id = e.id
      LEFT JOIN kpi_measurement m ON m.kpi_id = k.id AND m.period = ANY(${months})
      WHERE e.am_id IS NOT NULL
      GROUP BY e.am_id, k.id, k.perspective, e.dept
    `,
    sql`SELECT dept, perspective, weight::float8 AS weight FROM bsc_weight`,
  ]);

  const revenue = new Map(
    revRows.map((r) => [String(r.am_id), { revenue: Number(r.revenue), invoices: Number(r.invoices), target: r.target != null ? Number(r.target) : null }]),
  );
  const ar = new Map(arRows.map((r) => [String(r.am_id), { outstanding: Number(r.outstanding), invoices: Number(r.invoices) }]));
  const coaching = new Map(
    coachRows.map((r) => [String(r.am_id), { period: r.period ? String(r.period) : null, score: r.score != null ? Number(r.score) : null }]),
  );
  const leave = new Map(leaveRows.map((r) => [String(r.am_id), { days: Number(r.days), events: Number(r.events) }]));

  // BSC per am_id (renormalisasi bobot dept). Hanya dihitung kalau ada ≥1 measurement.
  const weightsByDept = new Map<string, Record<string, number>>();
  for (const w of weightRows) {
    const d = String(w.dept);
    const m = weightsByDept.get(d) ?? {};
    m[String(w.perspective)] = Number(w.weight);
    weightsByDept.set(d, m);
  }
  const kpiByAm = new Map<string, { kpi: { id: string; perspective: string | null }[]; inputs: Record<string, number>; dept: string | null; measured: number }>();
  for (const r of bscRows) {
    const am = String(r.am_id);
    const e = kpiByAm.get(am) ?? { kpi: [], inputs: {}, dept: r.dept ? String(r.dept) : null, measured: 0 };
    const id = String(r.kpi_id);
    e.kpi.push({ id, perspective: r.perspective ? String(r.perspective) : null });
    if (r.achievement_pct != null) {
      e.inputs[id] = Number(r.achievement_pct);
      e.measured++;
    }
    kpiByAm.set(am, e);
  }
  const bsc = new Map<string, { score: number; measured: number }>();
  for (const [am, e] of kpiByAm) {
    if (e.measured === 0) continue; // belum diukur periode ini → dim BSC dianggap kosong
    const s = bscScore(e.kpi, weightsByDept.get(e.dept ?? "") ?? {}, e.inputs);
    if (s) bsc.set(am, { score: s.score, measured: e.measured });
  }

  return { orang, compliance, revenue, ar, coaching, leave, bsc };
}

// ── LIST (admin/HoD → semua karyawan aktif) ──
export interface RaportListRow {
  am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; is_am: boolean;
  overall: number | null; rating: string;
  compliance: number | null; bsc: number | null; revenue: number; revenue_pct: number | null;
  active_days: number; leave_days: number; has_spine: boolean;
}

export async function getRaportList(period?: string): Promise<{ period: string; period_label: string; from: string; to: string; rows: RaportListRow[] }> {
  const { key: p, label, from, to, months } = periodBounds(period);
  const sql = db();
  const roster = await sql`SELECT am_id, nama, panggilan, role, cabang FROM master_user WHERE aktif ORDER BY cabang NULLS LAST, nama`;
  const spineRows = await sql`SELECT DISTINCT am_id FROM employee WHERE am_id IS NOT NULL`;
  const spineByAm = new Set(spineRows.map((r) => String(r.am_id)));
  const M = await collectMaps(from, to, months);

  const rows: RaportListRow[] = roster.map((u) => {
    const amId = String(u.am_id);
    const is_am = isAmRole(u.role);
    const o = M.orang.get(amId);
    const c = M.compliance.get(amId);
    const rev = M.revenue.get(amId);
    const arr = M.ar.get(amId);
    const coach = M.coaching.get(amId);
    const leave = M.leave.get(amId);
    const bscS = M.bsc.get(amId)?.score ?? null;
    const monthlyTarget = rev?.target ? rev.target / 12 : null;
    const revenue = rev?.revenue ?? 0;
    const revScore = is_am ? revenueScore(revenue, monthlyTarget) : null;

    const w = is_am ? RAPORT_WEIGHTS.am : RAPORT_WEIGHTS.non_am;
    const parts = is_am
      ? [
          { key: "bsc", label: "BSC/KPI", score: bscS, weight: w.bsc },
          { key: "compliance", label: "Plan & Report", score: complianceScore(c), weight: w.compliance },
          { key: "revenue", label: "Revenue", score: revScore, weight: (w as typeof RAPORT_WEIGHTS.am).revenue },
          { key: "ar", label: "AR", score: arScore(arr?.outstanding ?? 0, revenue), weight: (w as typeof RAPORT_WEIGHTS.am).ar },
          { key: "absensi", label: "Absensi (proxy)", score: absensiScore(o, c), weight: w.absensi },
          { key: "coaching", label: "Coaching", score: coach?.score ?? null, weight: w.coaching },
        ]
      : [
          { key: "bsc", label: "BSC/KPI", score: bscS, weight: w.bsc },
          { key: "compliance", label: "Plan & Report", score: complianceScore(c), weight: w.compliance },
          { key: "absensi", label: "Absensi (proxy)", score: absensiScore(o, c), weight: w.absensi },
          { key: "coaching", label: "Coaching", score: coach?.score ?? null, weight: w.coaching },
        ];
    const { overall } = compose(parts);

    return {
      am_id: amId, nama: String(u.nama), panggilan: u.panggilan ? String(u.panggilan) : null,
      role: String(u.role), cabang: u.cabang ? String(u.cabang) : null, is_am,
      overall, rating: ratingOf(overall),
      compliance: complianceScore(c), bsc: bscS, revenue, revenue_pct: revScore,
      active_days: o?.active_days ?? 0, leave_days: leave?.days ?? 0,
      has_spine: spineByAm.has(amId),
    };
  });

  return { period: p, period_label: label, from, to, rows };
}

// ── DETAIL (1 karyawan) ──
// Narasi AI tersimpan (Fase 3, tabel raport_narrative) — di-generate batch.
export interface StoredNarrative {
  verdict: string | null; headline: string | null;
  pantas_puas: string[]; penahan: string[]; bsc: Record<string, string>;
  akar_masalah: string; catatan_adil: string; ringkasan: string; predikat: string;
  model: string | null; generated_at: string | null;
}
export async function getStoredNarrative(amId: string, period: string): Promise<StoredNarrative | null> {
  const sql = db();
  const [r] = await sql`
    SELECT verdict, headline, narrative, model, created_at::text FROM raport_narrative
    WHERE am_id = ${amId} AND period = ${period}
  `;
  if (!r) return null;
  const n = (r.narrative ?? {}) as Record<string, unknown>;
  const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const str = (v: unknown): string => (v == null ? "" : String(v));
  return {
    verdict: r.verdict ? String(r.verdict) : null,
    headline: r.headline ? String(r.headline) : null,
    pantas_puas: asArr(n.pantas_puas),
    penahan: asArr(n.penahan),
    bsc: n.bsc && typeof n.bsc === "object" ? (n.bsc as Record<string, string>) : {},
    akar_masalah: str(n.akar_masalah),
    catatan_adil: str(n.catatan_adil),
    ringkasan: str(n.ringkasan),
    predikat: str(n.predikat),
    model: r.model ? String(r.model) : null,
    generated_at: r.created_at ? String(r.created_at) : null,
  };
}

export async function getRaportDetail(amId: string, period?: string): Promise<
  | { found: false }
  | {
      found: true;
      period: string; period_label: string; from: string; to: string;
      employee: { am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; is_am: boolean; spine_id: string | null };
      score: { overall: number | null; rating: string; parts: ScorePart[] };
      plan_report: { plan_count: number; report_count: number; completion: number | null; active_days: number; late: number; unmatched: number; expected: number; on_time: number; late_days: number; miss: number; compliance_rate: number | null } | null;
      bsc: { score: number | null; persp: Record<string, number>; objectives: Record<string, string[]>; kpi: { id: string; name: string; target: string | null; perspective: string | null; achievement_pct: number | null }[] } | null;
      okr: { objective: string | null; key_results: string[] } | null;
      raci: { process: string; role_type: string; note: string | null }[];
      pdca: { plan: string | null; do: string | null; check: string | null; act: string | null } | null;
      daily: { date: string; total: number; success: number }[];
      workload: { total: number; success: number; pending: number };
      items: {
        total: number;
        categories: { key: string; label: string; count: number }[];
        status: { key: string; label: string; color: string; count: number }[];
        failures: { tanggal: string; label: string; status: string }[];
        blockers: { tanggal: string; label: string; status: string }[];
      };
      absensi: { active_days: number; expected: number; leave_days: number; leave: { start_date: string; end_date: string; jenis: string; keterangan: string | null }[] };
      coaching: { period: string | null; score: number | null; strengths: string[]; gaps: string[]; recommendations: string[] } | null;
      revenue: { total: number; invoices: number; target_year: number | null; target_month: number | null; pct: number | null } | null;
      ar: { outstanding: number; invoices: number } | null;
      narrative: StoredNarrative | null;
      context_note: string;
    }
> {
  const { key: p, label: periodLabel, from, to, months } = periodBounds(period);
  const sql = db();
  const narrative = await getStoredNarrative(amId, p);
  const [u] = await sql`SELECT am_id, nama, panggilan, role, cabang FROM master_user WHERE am_id = ${amId}`;
  if (!u) return { found: false };
  const is_am = isAmRole(u.role);
  const year = Number(to.slice(0, 4));

  // Bridge am_id → employee slug (link eksplisit; fallback nama ternormalisasi).
  const [emp] = await sql`
    SELECT id FROM employee
    WHERE am_id = ${amId}
       OR lower(regexp_replace(nama, '\\s+', ' ', 'g')) = lower(regexp_replace(${String(u.nama)}, '\\s+', ' ', 'g'))
    ORDER BY (am_id = ${amId}) DESC LIMIT 1
  `;
  const spineId = emp ? String(emp.id) : null;

  const [orangRows, comp, leave, coachRows, revRow, arRow] = await Promise.all([
    reportPerOrang(from, to),
    reportCompliance(from, to),
    listLeave(amId, 50),
    sql`SELECT period, score::float8 AS score, strengths, gaps, recommendations FROM coaching_note WHERE am_id = ${amId} ORDER BY created_at DESC LIMIT 1`,
    is_am
      ? sql`
          SELECT COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS total, count(*)::int AS invoices,
                 max(sta.target)::float8 AS target
          FROM accurate_invoice ai
          JOIN accurate_salesman acs ON acs.id = ai.salesman_id
          JOIN master_user mu ON mu.am_id = acs.master_user_id::text
          LEFT JOIN sales_target_am sta ON sta.am_id = mu.am_id AND sta.year = ${year}
          WHERE mu.am_id = ${amId} AND ai.tanggal BETWEEN ${from} AND ${to}
        `
      : Promise.resolve([] as { total: number; invoices: number; target: number | null }[]),
    is_am
      ? sql`
          SELECT COALESCE(sum(ai.total),0)::float8 AS outstanding, count(*)::int AS invoices
          FROM accurate_invoice ai
          JOIN accurate_salesman acs ON acs.id = ai.salesman_id
          JOIN master_user mu ON mu.am_id = acs.master_user_id::text
          WHERE mu.am_id = ${amId} AND ai.status = 'OPEN'
        `
      : Promise.resolve([] as { outstanding: number; invoices: number }[]),
  ]);

  const o = orangRows.find((r) => r.am_id === amId);
  const c = comp.rows.find((r) => r.am_id === amId);

  // Spine (BSC/KPI/OKR/RACI) bila ter-bridge.
  let bsc: { score: number | null; persp: Record<string, number>; objectives: Record<string, string[]>; kpi: { id: string; name: string; target: string | null; perspective: string | null; achievement_pct: number | null }[] } | null = null;
  let okr: { objective: string | null; key_results: string[] } | null = null;
  let raci: { process: string; role_type: string; note: string | null }[] = [];
  let pdca: { plan: string | null; do: string | null; check: string | null; act: string | null } | null = null;
  if (spineId) {
    const [spine, meas] = await Promise.all([
      getEmployee(spineId),
      sql`
        SELECT m.kpi_id::text AS kpi_id, avg(m.achievement_pct)::float8 AS achievement_pct
        FROM kpi_measurement m JOIN kpi k ON k.id = m.kpi_id
        WHERE k.employee_id = ${spineId} AND m.period = ANY(${months})
        GROUP BY m.kpi_id
      `,
    ]);
    if (spine) {
      const inputs: Record<string, number> = {};
      for (const m of meas) inputs[String(m.kpi_id)] = Number(m.achievement_pct);
      const s = meas.length ? bscScore(spine.kpi, spine.weights as Record<string, number>, inputs) : null;
      bsc = {
        score: s?.score ?? null,
        persp: s?.perspScore ?? {},
        objectives: spine.bsc as Record<string, string[]>,
        kpi: spine.kpi.map((k) => ({ id: k.id, name: k.name, target: k.target, perspective: k.perspective, achievement_pct: inputs[k.id] ?? null })),
      };
      okr = { objective: spine.okr_objective, key_results: spine.okr_kr };
      raci = spine.raci;
      pdca = spine.pdca;
    }
  }

  // Beban & keberhasilan harian (chart) + total item/berhasil. AM = sales_plan;
  // non-AM = item TODO (sales_todo.report_data, status 'matched' = berhasil).
  const dailyRows = is_am
    ? await sql`
        SELECT tanggal::text AS d, count(*)::int AS total, count(*) FILTER (WHERE reported)::int AS success
        FROM sales_plan WHERE am_id = ${amId} AND tanggal BETWEEN ${from} AND ${to}
        GROUP BY tanggal ORDER BY tanggal
      `
    : await sql`
        SELECT tanggal::text AS d,
          sum(CASE WHEN jsonb_typeof(report_data)='array' THEN jsonb_array_length(report_data) ELSE 0 END)::int AS total,
          COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report_data)='array' THEN report_data ELSE '[]'::jsonb END) e WHERE e->>'status'='matched')),0)::int AS success
        FROM sales_todo WHERE am_id = ${amId} AND tanggal BETWEEN ${from} AND ${to} AND reported
        GROUP BY tanggal ORDER BY tanggal
      `;
  const daily = dailyRows.map((r) => ({ date: String(r.d), total: Number(r.total), success: Number(r.success) }));
  const workload = {
    total: daily.reduce((a, r) => a + r.total, 0),
    success: daily.reduce((a, r) => a + r.success, 0),
    pending: 0,
  };
  workload.pending = Math.max(0, workload.total - workload.success);

  // Item-level (Fase 2): kategori + status buckets + kegagalan/blokir. AM = visit
  // (sales_plan); non-AM = item TODO (sales_todo.report_data).
  const itemRows = is_am
    ? await sql`
        SELECT tanggal::text AS tanggal,
               COALESCE(NULLIF(customer_name,''), NULLIF(tujuan,''), 'Kunjungan') AS task,
               CASE WHEN reported THEN 'selesai' ELSE 'belum' END AS result,
               CASE WHEN reported THEN 'matched' ELSE 'unmatched' END AS status
        FROM sales_plan WHERE am_id = ${amId} AND tanggal BETWEEN ${from} AND ${to}
        ORDER BY tanggal DESC`
    : await sql`
        SELECT st.tanggal::text AS tanggal, item->>'task' AS task, item->>'result' AS result, item->>'status' AS status
        FROM sales_todo st
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.report_data)='array' THEN st.report_data ELSE '[]'::jsonb END) AS item
        WHERE st.am_id = ${amId} AND st.tanggal BETWEEN ${from} AND ${to} AND st.reported
        ORDER BY st.tanggal DESC`;
  const catCount = new Map<string, { label: string; count: number }>();
  const statCount = new Map<string, number>();
  const failures: { tanggal: string; label: string; status: string }[] = [];
  const blockers: { tanggal: string; label: string; status: string }[] = [];
  for (const it of itemRows) {
    const task = String(it.task ?? "").trim() || "(tanpa judul)";
    const result = String(it.result ?? "");
    const cat = categorize(`${task} ${result}`);
    const cc = catCount.get(cat.key) ?? { label: cat.label, count: 0 };
    cc.count++; catCount.set(cat.key, cc);
    const b = classifyStatus(String(it.status ?? ""), result);
    statCount.set(b.key, (statCount.get(b.key) ?? 0) + 1);
    if (b.kind === "fail" && failures.length < 12) failures.push({ tanggal: String(it.tanggal), label: task, status: "belum jalan" });
    else if (b.kind === "external" && blockers.length < 12) blockers.push({ tanggal: String(it.tanggal), label: task, status: shortWait(result) });
  }
  const items = {
    total: itemRows.length,
    categories: [...catCount.entries()].map(([key, v]) => ({ key, label: v.label, count: v.count })).sort((a, b) => b.count - a.count),
    status: STATUS_ORDER.filter((s) => statCount.get(s.key)).map((s) => ({ key: s.key, label: s.label, color: s.color, count: statCount.get(s.key) as number })),
    failures,
    blockers,
  };

  const rev = (revRow as { total: number; invoices: number; target: number | null }[])[0];
  const arr = (arRow as { outstanding: number; invoices: number }[])[0];
  const monthlyTarget = rev?.target ? rev.target / 12 : null;
  const revenueBlock = is_am
    ? {
        total: rev ? Number(rev.total) : 0,
        invoices: rev ? Number(rev.invoices) : 0,
        target_year: rev?.target != null ? Number(rev.target) : null,
        target_month: monthlyTarget,
        pct: revenueScore(rev ? Number(rev.total) : 0, monthlyTarget),
      }
    : null;
  const arBlock = is_am ? { outstanding: arr ? Number(arr.outstanding) : 0, invoices: arr ? Number(arr.invoices) : 0 } : null;

  const coachRaw = coachRows[0] as { period: string | null; score: number | null; strengths: unknown; gaps: unknown; recommendations: unknown } | undefined;
  const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const coaching = coachRaw
    ? { period: coachRaw.period ? String(coachRaw.period) : null, score: coachRaw.score != null ? Number(coachRaw.score) : null, strengths: asArr(coachRaw.strengths), gaps: asArr(coachRaw.gaps), recommendations: asArr(coachRaw.recommendations) }
    : null;

  // Komposit
  const w = is_am ? RAPORT_WEIGHTS.am : RAPORT_WEIGHTS.non_am;
  const parts = is_am
    ? [
        { key: "bsc", label: "BSC/KPI", score: bsc?.score ?? null, weight: w.bsc },
        { key: "compliance", label: "Plan & Report", score: complianceScore(c), weight: w.compliance },
        { key: "revenue", label: "Revenue", score: revenueBlock?.pct ?? null, weight: (w as typeof RAPORT_WEIGHTS.am).revenue },
        { key: "ar", label: "AR", score: arScore(arBlock?.outstanding ?? 0, revenueBlock?.total ?? 0), weight: (w as typeof RAPORT_WEIGHTS.am).ar },
        { key: "absensi", label: "Absensi (proxy)", score: absensiScore(o, c), weight: w.absensi },
        { key: "coaching", label: "Coaching", score: coaching?.score ?? null, weight: w.coaching },
      ]
    : [
        { key: "bsc", label: "BSC/KPI", score: bsc?.score ?? null, weight: w.bsc },
        { key: "compliance", label: "Plan & Report", score: complianceScore(c), weight: w.compliance },
        { key: "absensi", label: "Absensi (proxy)", score: absensiScore(o, c), weight: w.absensi },
        { key: "coaching", label: "Coaching", score: coaching?.score ?? null, weight: w.coaching },
      ];
  const { overall, parts: scoreParts } = compose(parts);

  return {
    found: true,
    period: p, period_label: periodLabel, from, to,
    employee: { am_id: amId, nama: String(u.nama), panggilan: u.panggilan ? String(u.panggilan) : null, role: String(u.role), cabang: u.cabang ? String(u.cabang) : null, is_am, spine_id: spineId },
    score: { overall, rating: ratingOf(overall), parts: scoreParts },
    plan_report: o || c
      ? {
          plan_count: o?.plan_count ?? 0, report_count: o?.report_count ?? 0, completion: o?.completion ?? null,
          active_days: o?.active_days ?? 0, late: o?.late ?? 0, unmatched: o?.unmatched ?? 0,
          expected: c?.expected ?? 0, on_time: c?.on_time ?? 0, late_days: c?.late ?? 0, miss: c?.miss ?? 0, compliance_rate: c?.compliance_rate ?? null,
        }
      : null,
    bsc,
    okr,
    raci,
    pdca,
    daily,
    workload,
    items,
    absensi: {
      active_days: o?.active_days ?? 0, expected: c?.expected ?? 0, leave_days: leave.reduce((a, l) => a + overlapDays(l.start_date, l.end_date, from, to), 0),
      leave: leave.map((l) => ({ start_date: l.start_date, end_date: l.end_date, jenis: l.jenis, keterangan: l.keterangan })),
    },
    coaching,
    revenue: revenueBlock,
    ar: arBlock,
    narrative,
    context_note: "Absensi = proxy (cuti + hari aktif); presensi clock-in belum ada. Pola/rekap/resume bersifat konteks group-level, bukan skor per-orang.",
  };
}

function overlapDays(start: string, end: string, from: string, to: string): number {
  const s = new Date(start > from ? start : from).getTime();
  const e = new Date(end < to ? end : to).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}
