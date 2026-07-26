"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  Activity, AlertTriangle, TrendingUp, TrendingDown, Wallet, MoonStar,
  Target, Building2, Sparkles, RefreshCw, Swords, Rocket, ArrowUpCircle, UserCog, Info,
  Lightbulb, Clock, User, LayoutDashboard, Radar, Users, ListChecks, ArrowUpRight, Download,
  Lock, Loader2, type LucideIcon,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Tipe respons API /executive/* ─────────────────────────────────
type Light = "green" | "yellow" | "red" | "na";

export interface CommandData {
  range: { from: string; to: string } | null;
  revenue_mtd: number; target_mtd: number | null; achievement_mtd_pct: number | null;
  revenue_ytd: number; target_ytd: number | null; achievement_ytd_pct: number | null;
  delta_mom_pct: number | null;
  ar_total: number | null; ar_over_90: number | null;
  dormant_count: number | null; dormant_value: number | null;
  red_flags: { hod: string; metric: string; actual: number | null; target: number | null; unit: string; pct: number | null }[];
  red_flags_count: number;
  opportunities: { customer: string | null; value: number | null; am_id: string | null; stage: string }[];
  trend?: { date: string; revenue: number }[];
}
interface AmRow {
  am_id: string | null; nama: string | null; cabang: string | null; region: string;
  total: number; count: number; target: number | null; achievement_pct: number | null;
  rank: number; self?: boolean; light: Light;
}
interface AmRadarData {
  range: { from: string; to: string }; scope: string;
  summary: { total: number; green: number; yellow: number; red: number; na: number };
  rows: AmRow[];
}
interface OutletData {
  summary: { total_customers: number; active: number; dormant: number; revenue_total: number; revenue_month: number };
  concentration: { top_customer: string | null; top_share_pct: number | null; top5_share_pct: number | null; flag: boolean };
  top_customers: { id: string; name: string; cabang: string | null; total: number; this_month: number; invoices: number; days_since: number | null; share_pct: number | null }[];
  dormant: { id: string; name: string; cabang: string | null; total: number; last_date: string | null; days_since: number | null }[];
}
interface Lever {
  id: number; title: string; impact_idr: number; owner: string; sla_days: number; rationale?: string;
}
interface LeversData {
  levers: Lever[]; model: string; dry_run: boolean; cached?: boolean;
}
interface DormantIntelData {
  new_customers: { id: string; name: string; first_date: string; invoices: number; total: number }[];
  reactivated: { id: string; name: string; reactivated_date: string; gap_days: number }[];
  silent: { id: string; name: string; last_date: string; days_since: number; total: number; invoices: number }[];
  competitor_mentions: { id: string; tanggal: string; vendor: string; produk: string | null; customer_name: string | null; am_id: string | null; konteks: string | null }[];
}
interface KpiData {
  as_of: string; count: number; note: string;
  kpis: { name: string; formula: string; unit: "IDR" | "%" | "count"; target: number | null; actual: number | null; status: Light; trend: number | null; lower_is_better?: boolean }[];
}
type Readiness = "ready-to-scale" | "stable" | "accelerated-dev" | "pip" | "belum-dinilai";
interface RotationRow {
  hod_key: string; hod_name: string; role: string; npk: number; predikat: string;
  available_count: number; readiness: Readiness; npk_prev: number | null; promotion_candidate: boolean;
}
interface RotationData {
  period: { year: number; period: string }; prev: { year: number; period: string };
  computed: boolean; accessible: boolean;
  summary: { total: number; scored: number; ready: number; stable: number; accel: number; pip: number; belum: number };
  rows: RotationRow[];
  top_performers: RotationRow[]; underperformers: RotationRow[]; promotion_candidates: RotationRow[];
}

type ViewKey = "command" | "am-radar" | "outlet-matrix" | "growth-levers" | "dormant-intel" | "rotation" | "kpi-baseline";
const TABS: { key: ViewKey; label: string; icon: LucideIcon; skel: "tiles" | "table" | "cards" }[] = [
  { key: "command", label: "Command", icon: LayoutDashboard, skel: "tiles" },
  { key: "am-radar", label: "AM Radar", icon: Radar, skel: "table" },
  { key: "outlet-matrix", label: "Outlet Matrix", icon: Building2, skel: "tiles" },
  { key: "growth-levers", label: "Growth Levers", icon: Lightbulb, skel: "cards" },
  { key: "dormant-intel", label: "Dormant Intel", icon: MoonStar, skel: "cards" },
  { key: "rotation", label: "Rotation", icon: Users, skel: "cards" },
  { key: "kpi-baseline", label: "KPI Baseline", icon: ListChecks, skel: "table" },
];

// ── Formatter ──────────────────────────────────────────────────────
const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
function rpc(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(2).replace(".", ",")} M`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(0)} jt`;
  return rp.format(n);
}
const pctFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const pctStr = (n: number | null | undefined) => (n == null ? "—" : `${pctFmt.format(n)}%`);
const numFmt = new Intl.NumberFormat("id-ID");
const clamp = (n: number) => Math.min(Math.max(n, 0), 100);

// ── Sistem warna status (reserved; selalu dot/chip + label, tak pernah warna-saja) ──
type Status = "good" | "warn" | "crit" | "na" | "info";
const ST: Record<Status, { chip: string; dot: string; fill: string; text: string; label: string }> = {
  good: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", fill: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "On Track" },
  warn: { chip: "bg-amber-500/14 text-amber-700 dark:text-amber-400", dot: "bg-amber-500", fill: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Perhatian" },
  crit: { chip: "bg-red-500/12 text-red-700 dark:text-red-400", dot: "bg-red-500", fill: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "Kritis" },
  info: { chip: "bg-sky-500/12 text-sky-700 dark:text-sky-400", dot: "bg-sky-500", fill: "bg-sky-500", text: "text-sky-600 dark:text-sky-400", label: "Stable" },
  na: { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/40", fill: "bg-muted-foreground/40", text: "text-muted-foreground", label: "N/A" },
};
const lightToStatus = (l: Light): Status => (l === "green" ? "good" : l === "yellow" ? "warn" : l === "red" ? "crit" : "na");
const pctStatus = (p: number | null | undefined): Status => (p == null ? "na" : p >= 90 ? "good" : p >= 75 ? "warn" : "crit");
const readinessStatus: Record<Readiness, Status> = {
  "ready-to-scale": "good", stable: "info", "accelerated-dev": "warn", pip: "crit", "belum-dinilai": "na",
};
const readinessLabel: Record<Readiness, string> = {
  "ready-to-scale": "Ready to Scale", stable: "Stable", "accelerated-dev": "Accelerated Dev", pip: "PIP", "belum-dinilai": "Belum Dinilai",
};

// ── Primitif visual ────────────────────────────────────────────────
function StatusChip({ status, children }: { status: Status; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", ST[status].chip)}>
      <span className={cn("size-1.5 rounded-full", ST[status].dot)} />
      {children}
    </span>
  );
}
// Progress bar dgn marker ambang (default 75/90).
function Meter({ pct, status, markers = [75, 90], className }: { pct: number | null | undefined; status: Status; markers?: number[]; className?: string }) {
  return (
    <div className={cn("relative h-1.5 rounded-full bg-muted", className)}>
      <div className={cn("absolute inset-y-0 left-0 rounded-full", ST[status].fill)} style={{ width: `${clamp(pct ?? 0)}%` }} />
      {markers.map((m) => (
        <span key={m} className="absolute -top-1 -bottom-1 w-px rounded bg-foreground/35" style={{ left: `${m}%` }} />
      ))}
    </div>
  );
}
// Bar inline utk tabel: track + fill + nilai.
function InlineMeter({ pct, status, label, width = "w-[150px]" }: { pct: number | null; status: Status; label: string; width?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2", width)}>
      <span className="relative h-1.5 flex-1 rounded-full bg-muted">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", ST[status].fill)} style={{ width: `${clamp(pct ?? 0)}%` }} />
      </span>
      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">{label}</span>
    </div>
  );
}
function StatTile({ label, value, icon: Icon, sub, subTone, children, href }: {
  label: string; value: string; icon: LucideIcon; sub?: string;
  subTone?: "up" | "down" | "muted"; children?: React.ReactNode; href?: string;
}) {
  const body = (
    <Card className={cn("gap-0 p-3.5", href && "transition-colors hover:border-primary/40 hover:bg-muted/30")}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs font-medium">{label}</span>
        {href ? <ArrowUpRight className="size-4 opacity-60 group-hover/tile:text-primary group-hover/tile:opacity-100" /> : <Icon className="size-4" />}
      </div>
      <div className="mt-1.5 text-[23px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
      {children}
      {sub ? (
        <p className={cn("mt-1.5 text-[11.5px]", subTone === "up" && ST.good.text, subTone === "down" && ST.crit.text, (!subTone || subTone === "muted") && "text-muted-foreground")}>{sub}</p>
      ) : null}
    </Card>
  );
  return href ? <Link href={href} className="group/tile block">{body}</Link> : body;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}
// Drill-down ke halaman sumber (AC-8) — dipasang di header kartu.
function DrillLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-primary">
      {children ?? "Detail"} <ArrowUpRight className="size-3.5" />
    </Link>
  );
}
// Sparkline tren revenue harian (recharts area, currentColor → theme-aware).
function Sparkline({ data }: { data: { date: string; revenue: number }[] }) {
  if (!data?.length) return null;
  return (
    <div className="text-primary">
      <ResponsiveContainer width="100%" height={46}>
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id="execSpark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip cursor={{ stroke: "currentColor", strokeOpacity: 0.25 }}
            content={({ active, payload }) => active && payload?.length ? (
              <div className="rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow">
                <div className="text-muted-foreground">{String(payload[0].payload.date)}</div>
                <div className="font-semibold tabular-nums">{rpc(Number(payload[0].value))}</div>
              </div>
            ) : null} />
          <Area type="monotone" dataKey="revenue" stroke="currentColor" strokeWidth={2} fill="url(#execSpark)" dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
// ── Export CSV (BOM UTF-8 + sep=, → Excel lokal mulus, sesuai gotcha dashboard) ──
function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + "sep=,\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(url);
}
// Bangun CSV (angka mentah) dari data view aktif. null → tak ada yang di-export.
function viewCsv(tab: ViewKey, data: unknown): { name: string; headers: string[]; rows: (string | number | null)[][] } | null {
  if (!data) return null;
  if (tab === "command") {
    const d = data as CommandData;
    return { name: "executive_command", headers: ["Metrik", "Nilai", "Target", "Achievement %"], rows: [
      ["Revenue MTD", d.revenue_mtd, d.target_mtd, d.achievement_mtd_pct],
      ["Revenue YTD", d.revenue_ytd, d.target_ytd, d.achievement_ytd_pct],
      ["Growth MoM %", d.delta_mom_pct, null, null],
      ["AR > 90 hari", d.ar_over_90, d.ar_total, null],
      ["Customer Dormant", d.dormant_count, null, null],
      ["Nilai Dormant at-risk", d.dormant_value, null, null],
      ["Red Flags", d.red_flags_count, null, null],
    ] };
  }
  if (tab === "am-radar") {
    const d = data as AmRadarData;
    return { name: "executive_am-radar", headers: ["Rank", "AM", "Cabang", "Region", "Revenue", "Target", "Achievement %", "Status"],
      rows: d.rows.map((r) => [r.rank, r.nama, r.cabang, r.region, r.total, r.target, r.achievement_pct, ST[lightToStatus(r.light)].label]) };
  }
  if (tab === "outlet-matrix") {
    const d = data as OutletData;
    return { name: "executive_outlet-top-customers", headers: ["#", "Customer", "Cabang", "Revenue", "Share %", "Faktur"],
      rows: d.top_customers.map((c, i) => [i + 1, c.name, c.cabang, c.total, c.share_pct, c.invoices]) };
  }
  if (tab === "growth-levers") {
    const d = data as LeversData;
    return { name: "executive_growth-levers", headers: ["#", "Lever", "Impact IDR", "Owner", "SLA hari", "Rationale"],
      rows: d.levers.map((l, i) => [i + 1, l.title, l.impact_idr, l.owner, l.sla_days, l.rationale ?? ""]) };
  }
  if (tab === "dormant-intel") {
    const d = data as DormantIntelData;
    const rows: (string | number | null)[][] = [];
    d.new_customers.forEach((c) => rows.push(["Customer Baru", c.name, c.first_date, c.total]));
    d.reactivated.forEach((c) => rows.push(["Reaktivasi", c.name, c.reactivated_date, `senyap ${c.gap_days} hari`]));
    d.silent.forEach((c) => rows.push(["Suddenly Silent", c.name, c.last_date, `${c.days_since} hari`]));
    d.competitor_mentions.forEach((c) => rows.push(["Competitor", `${c.vendor}${c.produk ? " · " + c.produk : ""}`, c.tanggal, c.customer_name]));
    return rows.length ? { name: "executive_dormant-intel", headers: ["Kategori", "Nama", "Tanggal", "Info"], rows } : null;
  }
  if (tab === "rotation") {
    const d = data as RotationData;
    if (!d.accessible) return null;
    return { name: "executive_rotation-npk", headers: ["HoD", "Role", "NPK", "NPK prev", "Predikat", "Readiness", "Kandidat Promosi"],
      rows: d.rows.map((r) => [r.hod_name, r.role, r.available_count > 0 ? r.npk : null, r.npk_prev, r.available_count > 0 ? r.predikat.replace(/_/g, " ") : null, readinessLabel[r.readiness], r.promotion_candidate ? "ya" : ""]) };
  }
  if (tab === "kpi-baseline") {
    const d = data as KpiData;
    return { name: "executive_kpi-baseline", headers: ["KPI", "Formula", "Target", "Aktual", "Status", "Trend %"],
      rows: d.kpis.map((k) => [k.name, k.formula, k.target, k.actual, ST[lightToStatus(k.status)].label, k.trend]) };
  }
  return null;
}

// HoD (AC-5) hanya lihat subset: Command (read-only) + AM Radar tim sendiri.
const HOD_TABS: ViewKey[] = ["command", "am-radar"];

// ── Komponen utama ─────────────────────────────────────────────────
export function ExecutiveDashboard({ initial, initialView, access = "full" }: { initial: CommandData | null; initialView?: string; access?: "full" | "hod" }) {
  const tabs = access === "hod" ? TABS.filter((t) => HOD_TABS.includes(t.key)) : TABS;
  const startTab = (tabs.find((t) => t.key === initialView)?.key ?? tabs[0].key) as ViewKey;
  const [tab, setTab] = useState<ViewKey>(startTab);
  const [cache, setCache] = useState<Record<string, unknown>>(initial ? { command: initial } : {});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (view: ViewKey, force = false) => {
    if (!force && cache[view]) return;
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/executive/${view}${force ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setCache((c) => ({ ...c, [view]: data }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      setLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    void load(tab);
  }, [tab, load]);

  const cur = cache[tab];
  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0];
  const csv = cur ? viewCsv(tab, cur) : null;

  return (
    <div className="flex flex-col gap-4">
      {access === "hod" ? (
        <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]", ST.info.chip)}>
          <Lock className="size-4" /> Tampilan HoD — akses terbatas (Command &amp; AM Radar tim Anda, read-only). Menu lengkap untuk Direktur.
        </div>
      ) : null}
      {/* Toolbar: tab bar ber-ikon (sticky, scroll di mobil) + Export + Refresh */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b bg-background/85 px-4 py-1 backdrop-blur md:-mx-6 md:px-6">
        <nav className="flex flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn("flex flex-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.icon className="size-4 opacity-90" />
                {t.label}
              </button>
            );
          })}
        </nav>
        <Button size="sm" variant="ghost" className="flex-none" disabled={!csv} title="Export CSV"
          onClick={() => { if (csv) downloadCsv(csv.name, csv.headers, csv.rows); }}>
          <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
        </Button>
        <Button size="sm" variant="outline" className="flex-none" onClick={() => void load(tab, true)} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} /> <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {err ? (
        <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-destructive"><AlertTriangle className="size-4" /> Gagal memuat: {err}</CardContent></Card>
      ) : loading && tab === "growth-levers" ? (
        // Growth Levers = LLM (beberapa detik) → loading eksplisit walau data lama masih ada
        // (mis. saat Refresh) biar tak terkesan blank/diam.
        <LeversLoading />
      ) : loading && !cur ? (
        <ViewSkeleton kind={activeTab.skel} />
      ) : (
        <>
          {tab === "command" && <CommandView d={cur as CommandData | undefined} />}
          {tab === "am-radar" && <AmRadarView d={cur as AmRadarData | undefined} />}
          {tab === "outlet-matrix" && <OutletView d={cur as OutletData | undefined} />}
          {tab === "growth-levers" && <LeversView d={cur as LeversData | undefined} />}
          {tab === "dormant-intel" && <DormantView d={cur as DormantIntelData | undefined} />}
          {tab === "rotation" && <RotationView d={cur as RotationData | undefined} />}
          {tab === "kpi-baseline" && <KpiView d={cur as KpiData | undefined} />}
        </>
      )}
    </div>
  );
}

function ViewSkeleton({ kind }: { kind: "tiles" | "table" | "cards" }) {
  if (kind === "table") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-24 rounded-full" />)}</div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (kind === "cards") {
    return <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
    </div>
  );
}

// Loading khusus Growth Levers (LLM ±beberapa detik) — indikator eksplisit + skeleton kartu.
function LeversLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]", ST.info.chip)}>
        <Loader2 className="size-4 animate-spin" />
        <span>AI sedang menyusun rekomendasi growth lever dari sinyal terbaru… (beberapa detik)</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-0 p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-7 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-5/6" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── View 1: COMMAND ────────────────────────────────────────────────
function CommandView({ d }: { d: CommandData | undefined }) {
  if (!d) return null;
  const momTone = d.delta_mom_pct == null ? "muted" : d.delta_mom_pct >= 0 ? "up" : "down";
  const mtdStatus = pctStatus(d.achievement_mtd_pct);
  return (
    <div className="flex flex-col gap-3">
      {/* Hero: Revenue MTD vs target */}
      <Card className="overflow-hidden p-0">
        <div className="grid md:grid-cols-[1.15fr_1fr]">
          <div className="p-5">
            <SectionLabel>Revenue MTD{d.range ? ` · ${d.range.from} – ${d.range.to}` : ""}</SectionLabel>
            <div className="mt-1.5 text-[32px] font-bold leading-none tracking-tight tabular-nums">{rpc(d.revenue_mtd)}</div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {d.target_mtd != null ? (<>Target <span className="font-semibold text-foreground tabular-nums">{rpc(d.target_mtd)}</span> · <span className={cn("font-semibold", ST[mtdStatus].text)}>{pctStr(d.achievement_mtd_pct)} tercapai</span></>) : "Target belum diisi"}
            </p>
            <Meter className="mt-3" pct={d.achievement_mtd_pct} status={mtdStatus} />
            <div className="mt-1.5 flex justify-between text-[10.5px] tabular-nums text-muted-foreground"><span>0</span><span>75%</span><span>90%</span><span>target</span></div>
          </div>
          <div className="flex flex-col justify-center gap-2.5 border-t bg-muted/30 p-5 md:border-l md:border-t-0">
            {d.trend && d.trend.length > 1 ? (
              <div>
                <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Tren revenue harian · 30 hari</div>
                <Sparkline data={d.trend} />
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Growth MoM</span>
              <span className={cn("inline-flex items-center gap-1 text-sm font-semibold tabular-nums", momTone === "up" && ST.good.text, momTone === "down" && ST.crit.text)}>
                {momTone === "down" ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}{pctStr(d.delta_mom_pct)}
              </span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Revenue YTD</span>
              <span className="text-sm font-semibold tabular-nums">{rpc(d.revenue_ytd)}</span>
            </div>
            {d.target_ytd != null ? <Meter pct={d.achievement_ytd_pct} status={pctStatus(d.achievement_ytd_pct)} className="h-1" markers={[]} /> : null}
            <p className="text-[11px] text-muted-foreground">{d.target_ytd != null ? `${pctStr(d.achievement_ytd_pct)} dari target ${rpc(d.target_ytd)}` : "Target YTD belum diisi"}</p>
          </div>
        </div>
      </Card>

      {/* KPI risiko */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="AR > 90 hari" value={rpc(d.ar_over_90)} icon={Wallet} href="/ar"
          sub={d.ar_total != null ? `${d.ar_total > 0 ? Math.round((d.ar_over_90 ?? 0) / d.ar_total * 100) : 0}% dari total AR ${rpc(d.ar_total)}` : undefined}
          subTone={d.ar_over_90 && d.ar_over_90 > 0 ? "down" : "muted"}>
          {d.ar_total && d.ar_over_90 != null ? <Meter className="mt-2.5" markers={[]} pct={(d.ar_over_90 / d.ar_total) * 100} status="crit" /> : null}
        </StatTile>
        <StatTile label="Customer Dormant" value={d.dormant_count != null ? numFmt.format(d.dormant_count) : "—"} icon={MoonStar} href="/customers"
          sub={d.dormant_value != null ? `nilai at-risk ${rpc(d.dormant_value)} · >60 hari` : undefined} />
        <StatTile label="Red Flags · WatchPoint" value={numFmt.format(d.red_flags_count)} icon={AlertTriangle} href="/watchpoint"
          sub="metric HoD status merah" subTone={d.red_flags_count > 0 ? "down" : "up"} />
      </div>

      {/* Risk + Opportunity */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2 space-y-0 pb-3">
            <AlertTriangle className={cn("size-4", ST.crit.text)} />
            <CardTitle className="text-base">Top Risk</CardTitle>
            {d.red_flags.length > 0 ? <StatusChip status="crit">{d.red_flags.length} kritis</StatusChip> : null}
            <DrillLink href="/watchpoint">WatchPoint</DrillLink>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {d.red_flags.length === 0 ? (
              <EmptyRow icon={Sparkles} text="Tidak ada red flag." />
            ) : d.red_flags.map((r, i) => (
              <ListRow key={i} title={r.metric} sub={`HoD ${r.hod}${r.target != null ? ` · target ${r.unit === "Rp" ? rpc(r.target) : numFmt.format(r.target)}` : ""}`}
                right={<StatusChip status="crit">{r.pct != null ? pctStr(r.pct) : "RED"}</StatusChip>} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center gap-2 space-y-0 pb-3">
            <Rocket className={cn("size-4", ST.good.text)} />
            <CardTitle className="text-base">Opportunities · Deal Negosiasi</CardTitle>
            <DrillLink href="/pipeline">Pipeline</DrillLink>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {d.opportunities.length === 0 ? (
              <EmptyRow icon={Info} text="Belum ada deal di stage Negosiasi." />
            ) : d.opportunities.map((o, i) => (
              <ListRow key={i} rank={i + 1} title={o.customer ?? "—"} sub={`${o.stage}${o.am_id ? ` · AM ${o.am_id}` : ""}`}
                right={<span className="text-sm font-bold tabular-nums">{rpc(o.value)}</span>} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ListRow({ rank, title, sub, right }: { rank?: number; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      {rank != null ? <span className="grid size-6 flex-none place-items-center rounded-md bg-primary/10 text-[11.5px] font-bold text-primary tabular-nums">{rank}</span> : null}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
      {right ? <div className="ml-auto flex-none text-right">{right}</div> : null}
    </div>
  );
}
function EmptyRow({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-muted-foreground"><Icon className="size-4" /> {text}</div>;
}

// ── View 2: AM RADAR ───────────────────────────────────────────────
type SortKey = "rank" | "total" | "achievement_pct";
function AmRadarView({ d }: { d: AmRadarData | undefined }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [asc, setAsc] = useState(true);
  if (!d) return null;

  const maxRev = Math.max(1, ...d.rows.map((r) => r.total));
  const rows = [...d.rows].sort((a, b) => {
    const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
    return asc ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });
  const toggle = (k: SortKey) => { if (k === sortKey) setAsc(!asc); else { setSortKey(k); setAsc(k === "rank"); } };
  const arrow = (k: SortKey) => (k === sortKey ? (asc ? " ↑" : " ↓") : "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status="na">{d.summary.total} AM</StatusChip>
        <StatusChip status="good">{d.summary.green} On Track</StatusChip>
        <StatusChip status="warn">{d.summary.yellow} Perhatian</StatusChip>
        <StatusChip status="crit">{d.summary.red} Kritis</StatusChip>
        {d.summary.na > 0 ? <StatusChip status="na">{d.summary.na} N/A</StatusChip> : null}
        <DrillLink href="/sales-analytics?view=per-am">Detail per-AM (F127)</DrillLink>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggle("rank")}>#{arrow("rank")}</TableHead>
                <TableHead>AM</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggle("total")}>Revenue{arrow("total")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggle("achievement_pct")}>Achievement{arrow("achievement_pct")}</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = lightToStatus(r.light);
                return (
                  <TableRow key={`${r.rank}-${r.am_id ?? r.nama}`} className={cn(r.self && "bg-primary/5")}>
                    <TableCell className="text-muted-foreground tabular-nums">{r.rank}</TableCell>
                    <TableCell className="font-medium">{r.nama ?? "—"}{r.self ? <Badge variant="secondary" className="ml-2">Anda</Badge> : null}</TableCell>
                    <TableCell className="text-muted-foreground">{r.cabang ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.region}</TableCell>
                    <TableCell className="text-right">
                      <div className="tabular-nums">{rpc(r.total)}</div>
                      <span className="mt-1 inline-block h-1.5 rounded-full bg-primary/80" style={{ width: `${Math.round((r.total / maxRev) * 88)}px` }} />
                    </TableCell>
                    <TableCell><InlineMeter pct={r.achievement_pct} status={st} label={pctStr(r.achievement_pct)} /></TableCell>
                    <TableCell><StatusChip status={st}>{ST[st].label}</StatusChip></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── View 3: OUTLET MATRIX ──────────────────────────────────────────
function OutletView({ d }: { d: OutletData | undefined }) {
  if (!d) return null;
  const top1 = d.concentration.top_share_pct ?? 0;
  const top5 = d.concentration.top5_share_pct ?? 0;
  const mid = Math.max(0, top5 - top1);
  const rest = Math.max(0, 100 - top5);
  const maxShare = Math.max(1, ...d.top_customers.map((c) => c.share_pct ?? 0));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total Faskes" value={numFmt.format(d.summary.total_customers)} icon={Building2} sub={`${d.summary.active} aktif · ${d.summary.dormant} dormant`} />
        <StatTile label="Revenue Bulan Ini" value={rpc(d.summary.revenue_month)} icon={Activity} />
        <StatTile label="Konsentrasi Top-1" value={pctStr(d.concentration.top_share_pct)} icon={Target} sub={d.concentration.top_customer ?? undefined} subTone={d.concentration.flag ? "down" : "muted"} />
        <StatTile label="Konsentrasi Top-5" value={pctStr(d.concentration.top5_share_pct)} icon={Target} sub="5 faskes teratas" />
      </div>

      <Card className="gap-0 p-4">
        <SectionLabel>Konsentrasi revenue</SectionLabel>
        <div className="mt-2.5 flex h-6 gap-0.5 overflow-hidden rounded-lg bg-muted p-0.5">
          <span className="grid place-items-center rounded bg-primary text-[11px] font-semibold text-primary-foreground" style={{ width: `${clamp(top1)}%` }} title={`Top-1 ${pctStr(top1)}`}>{top1 >= 6 ? `${Math.round(top1)}%` : ""}</span>
          <span className="grid place-items-center rounded bg-sky-500 text-[11px] font-semibold text-white" style={{ width: `${clamp(mid)}%` }} title={`Top 2–5 ${mid.toFixed(1)}%`}>{mid >= 8 ? `${Math.round(mid)}%` : ""}</span>
          <span className="grid place-items-center rounded bg-muted-foreground/40 px-1 text-[11px] font-medium text-foreground/70" style={{ width: `${clamp(rest)}%` }} title={`Sisanya ${rest.toFixed(1)}%`}>Sisa · {Math.round(rest)}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <StatusChip status="na">Top-1</StatusChip><StatusChip status="info">Top 2–5</StatusChip><StatusChip status="na">Sisanya</StatusChip>
        </div>
        {d.concentration.flag ? (
          <p className={cn("mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]", ST.crit.chip)}>
            <AlertTriangle className="size-4" /> Risiko konsentrasi: <strong>{d.concentration.top_customer}</strong> menyumbang {pctStr(d.concentration.top_share_pct)} revenue (&gt;30%).
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 space-y-0 pb-2"><CardTitle className="text-base">Top 20 Customer by Revenue</CardTitle><DrillLink href="/customers">Customers</DrillLink></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Cabang</TableHead>
              <TableHead className="text-right">Revenue</TableHead><TableHead>Share</TableHead><TableHead className="text-right">Faktur</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.top_customers.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.cabang ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpc(c.total)}</TableCell>
                  <TableCell><InlineMeter pct={((c.share_pct ?? 0) / maxShare) * 100} status="na" label={pctStr(c.share_pct)} width="w-[120px]" /></TableCell>
                  <TableCell className="text-right tabular-nums">{c.invoices}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 space-y-0 pb-2">
          <MoonStar className={cn("size-4", ST.warn.text)} /><CardTitle className="text-base">Dormant Bernilai Tinggi (&gt;60 hari)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Cabang</TableHead><TableHead className="text-right">Revenue Hist.</TableHead>
              <TableHead className="text-right">Order Terakhir</TableHead><TableHead className="text-right">Hari</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.dormant.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">Tidak ada.</TableCell></TableRow>
              ) : d.dormant.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.cabang ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpc(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{c.last_date ?? "—"}</TableCell>
                  <TableCell className={cn("text-right tabular-nums font-medium", ST.warn.text)}>{c.days_since ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── View 4: GROWTH LEVERS ──────────────────────────────────────────
function LeversView({ d }: { d: LeversData | undefined }) {
  if (!d) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary"><Lightbulb className="size-3.5" /> {d.levers.length} Lever</span>
        {d.dry_run ? <StatusChip status="na">template (tanpa LLM)</StatusChip> : <StatusChip status="good">LLM · {d.model}</StatusChip>}
        {d.cached ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">cached</span> : null}
      </div>
      {d.levers.length === 0 ? (
        <Card><CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Info className="size-4" /> Belum ada lever — sinyal minim atau layanan AI tak tersedia. Coba Refresh.</CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {d.levers.map((lv, i) => (
            <Card key={lv.id ?? i} className="gap-0 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-7 flex-none place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground tabular-nums">{i + 1}</span>
                <p className="text-[14px] font-semibold leading-snug tracking-tight">{lv.title}</p>
              </div>
              {lv.rationale ? <p className="mt-2 text-[12.5px] text-muted-foreground">{lv.rationale}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {lv.impact_idr > 0 ? <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium", ST.good.chip)}><TrendingUp className="size-3.5" /> Impact {rpc(lv.impact_idr)}</span> : null}
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground"><User className="size-3.5" /> {lv.owner || "—"}</span>
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground"><Clock className="size-3.5" /> SLA {lv.sla_days} hari</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground"><Info className="size-3.5" /> Prioritas impact × urgency × ease · sintesis dari stuck deals (F1) · red flags (F76) · AR&gt;90 · dormant. Cache 6 jam — pakai Refresh untuk generate ulang.</p>
    </div>
  );
}

// ── View 5: DORMANT INTEL ──────────────────────────────────────────
function IntelSection<T>({ title, icon: Icon, iconStatus, items, empty, render }: {
  title: string; icon: LucideIcon; iconStatus: Status; items: T[]; empty: string; render: (it: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2 space-y-0 pb-2">
        <Icon className={cn("size-4", ST[iconStatus].text)} />
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{items.length}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 ? <EmptyRow icon={Info} text={empty} /> : items.map(render)}
      </CardContent>
    </Card>
  );
}
function DormantView({ d }: { d: DormantIntelData | undefined }) {
  if (!d) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <IntelSection title="Customer Baru (7 hari)" icon={Sparkles} iconStatus="good" items={d.new_customers} empty="Belum ada customer baru minggu ini."
        render={(c) => <ListRow key={c.id} title={c.name} sub={`${c.first_date} · ${c.invoices} faktur`} right={<span className="text-sm font-semibold tabular-nums">{rpc(c.total)}</span>} />} />
      <IntelSection title="Reaktivasi (setelah >60 hari)" icon={TrendingUp} iconStatus="good" items={d.reactivated} empty="Belum ada reaktivasi."
        render={(c) => <ListRow key={c.id + c.reactivated_date} title={c.name} sub={c.reactivated_date} right={<StatusChip status="good">senyap {c.gap_days} hari</StatusChip>} />} />
      <IntelSection title="Suddenly Silent (30–60 hari)" icon={MoonStar} iconStatus="crit" items={d.silent} empty="Tidak ada sinyal early-churn."
        render={(c) => <ListRow key={c.id} title={c.name} sub={`terakhir ${c.last_date} · ${c.invoices} faktur`} right={<StatusChip status="crit">{c.days_since} hari</StatusChip>} />} />
      <IntelSection title="Competitor Mentions" icon={Swords} iconStatus="warn" items={d.competitor_mentions} empty="Belum ada mention kompetitor."
        render={(c) => <ListRow key={c.id} title={`${c.vendor}${c.produk ? ` · ${c.produk}` : ""}`} sub={`${c.customer_name ?? "—"}${c.konteks ? ` — ${c.konteks}` : ""}`} right={<span className="text-[11px] text-muted-foreground">{c.tanggal}</span>} />} />
    </div>
  );
}

// ── View 6: ROTATION (F66 NPK) ─────────────────────────────────────
function RotationView({ d }: { d: RotationData | undefined }) {
  if (!d) return null;
  if (!d.accessible) {
    return <Card><CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Info className="size-4" /> Data NPK bersifat sensitif (HR) — akun ini tidak berwenang melihat skor NPK seluruh HoD.</CardContent></Card>;
  }
  const perStr = (p: { year: number; period: string }) => `${p.period} ${p.year}`;
  const distAll: { s: Status; n: number }[] = [
    { s: "good", n: d.summary.ready }, { s: "info", n: d.summary.stable },
    { s: "warn", n: d.summary.accel }, { s: "crit", n: d.summary.pip },
  ];
  const dist = distAll.filter((x) => x.n > 0);
  const distTotal = Math.max(1, dist.reduce((a, x) => a + x.n, 0));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <StatusChip status="na">{d.summary.total} HoD · {perStr(d.period)}</StatusChip>
        <StatusChip status="good">{d.summary.ready} Ready to Scale</StatusChip>
        <StatusChip status="info">{d.summary.stable} Stable</StatusChip>
        <StatusChip status="warn">{d.summary.accel} Accelerated Dev</StatusChip>
        <StatusChip status="crit">{d.summary.pip} PIP</StatusChip>
        {d.summary.belum > 0 ? <StatusChip status="na">{d.summary.belum} Belum Dinilai</StatusChip> : null}
      </div>
      {dist.length > 0 ? (
        <Card className="gap-0 p-4">
          <SectionLabel>Distribusi readiness</SectionLabel>
          <div className="mt-2.5 flex h-6 gap-0.5 overflow-hidden rounded-lg bg-muted p-0.5">
            {dist.map((x) => (
              <span key={x.s} className={cn("grid place-items-center rounded text-[11px] font-semibold text-white", ST[x.s].fill)} style={{ width: `${(x.n / distTotal) * 100}%` }}>{x.n}</span>
            ))}
          </div>
        </Card>
      ) : null}
      {!d.computed ? (
        <p className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]", ST.na.chip)}><Info className="size-4" /> NPK {perStr(d.period)} belum di-compute — jalankan compute NPK dulu (menu NPK Direktur).</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <NpkCard title="Kandidat Promosi" icon={ArrowUpCircle} iconStatus="good" hint="NPK ≥75 dua semester berturut · SK Ps. 2.2" rows={d.promotion_candidates} showPrev valTone="good" />
        <NpkCard title="Top Performer" icon={Rocket} iconStatus="good" hint="NPK ≥90 · Sangat Baik" rows={d.top_performers} />
        <NpkCard title="Underperformer" icon={AlertTriangle} iconStatus="crit" hint="NPK <60 · perlu intervensi" rows={d.underperformers} valTone="crit" />
      </div>

      <Card>
        <CardHeader className="flex items-center gap-2 space-y-0 pb-2"><UserCog className="size-4" /><CardTitle className="text-base">HoD Readiness</CardTitle><DrillLink href="/npk">NPK Direktur</DrillLink></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>HoD</TableHead><TableHead>Role</TableHead><TableHead className="text-right">NPK</TableHead>
              <TableHead className="text-right">{perStr(d.prev)}</TableHead><TableHead>Predikat</TableHead><TableHead>Readiness</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.hod_key}>
                  <TableCell className="font-medium">{r.hod_name}{r.promotion_candidate ? <ArrowUpCircle className={cn("ml-1.5 inline size-3.5", ST.good.text)} /> : null}</TableCell>
                  <TableCell className="text-muted-foreground">{r.role}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.available_count > 0 ? r.npk : "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{r.npk_prev ?? "—"}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{r.available_count > 0 ? r.predikat.replace(/_/g, " ") : "—"}</TableCell>
                  <TableCell><StatusChip status={readinessStatus[r.readiness]}>{readinessLabel[r.readiness]}</StatusChip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
function NpkCard({ title, icon: Icon, iconStatus, hint, rows, showPrev, valTone }: {
  title: string; icon: LucideIcon; iconStatus: Status; hint: string; rows: RotationRow[]; showPrev?: boolean; valTone?: Status;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2 space-y-0 pb-2">
        <Icon className={cn("size-4", ST[iconStatus].text)} />
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{rows.length}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-[11px] text-muted-foreground">{hint}</p>
        {rows.length === 0 ? <p className="py-1 text-sm text-muted-foreground">Belum ada.</p> : rows.map((r) => (
          <div key={r.hod_key} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{r.hod_name}</p><p className="text-[11px] text-muted-foreground">{r.role}</p></div>
            <span className="ml-auto flex-none text-right">
              <b className={cn("text-sm tabular-nums", valTone && ST[valTone].text)}>{r.npk}</b>
              {showPrev && r.npk_prev != null ? <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">(prev {r.npk_prev})</span> : null}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── View 7: KPI BASELINE ───────────────────────────────────────────
function KpiView({ d }: { d: KpiData | undefined }) {
  if (!d) return null;
  const fmt = (v: number | null, unit: "IDR" | "%" | "count") => v == null ? "—" : unit === "IDR" ? rpc(v) : unit === "%" ? `${v}%` : numFmt.format(v);
  const barPct = (k: KpiData["kpis"][number]) => {
    if (k.actual == null) return 0;
    if (k.unit === "%") return clamp(k.lower_is_better ? k.actual * 2 : k.actual);
    if (k.unit === "IDR" && k.target) return clamp((k.actual / k.target) * 100);
    return clamp(k.actual * 10);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground"><Info className="size-3.5" /> Per {d.as_of} · {d.note}</p>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>KPI</TableHead><TableHead className="text-right">Target</TableHead>
              <TableHead>Aktual vs Target</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Trend</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {d.kpis.map((k) => {
                const st = lightToStatus(k.status);
                return (
                  <TableRow key={k.name}>
                    <TableCell className="font-medium">{k.name}<span className="block text-[11px] font-normal text-muted-foreground">{k.formula}</span></TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{fmt(k.target, k.unit)}</TableCell>
                    <TableCell><InlineMeter pct={barPct(k)} status={st} label={fmt(k.actual, k.unit)} /></TableCell>
                    <TableCell><StatusChip status={st}>{ST[st].label}</StatusChip></TableCell>
                    <TableCell className="text-right tabular-nums">{k.trend == null ? <span className="text-muted-foreground">—</span> : (
                      <span className={cn(k.trend >= 0 ? ST.good.text : ST.crit.text)}>{k.trend >= 0 ? "▲" : "▼"} {Math.abs(k.trend)}%</span>)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
