"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, TrendingUp, TrendingDown, Wallet, MoonStar,
  Target, Building2, Sparkles, RefreshCw, Swords, Rocket, ArrowUpCircle, UserCog, Info,
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

type ViewKey = "command" | "am-radar" | "outlet-matrix" | "dormant-intel" | "rotation" | "kpi-baseline";
const TABS: { key: ViewKey; label: string }[] = [
  { key: "command", label: "Command" },
  { key: "am-radar", label: "AM Radar" },
  { key: "outlet-matrix", label: "Outlet Matrix" },
  { key: "dormant-intel", label: "Dormant Intel" },
  { key: "rotation", label: "Rotation" },
  { key: "kpi-baseline", label: "KPI Baseline" },
];

// ── Formatter ──────────────────────────────────────────────────────
const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
function rpc(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(n / 1e9).toFixed(1)} M`;
  if (a >= 1e6) return `Rp ${(n / 1e6).toFixed(0)} jt`;
  return rp.format(n);
}
const pctStr = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const numFmt = new Intl.NumberFormat("id-ID");

const LIGHT_DOT: Record<Light, string> = {
  green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-red-500", na: "bg-muted-foreground/40",
};
const LIGHT_LABEL: Record<Light, string> = { green: "On Track", yellow: "Perhatian", red: "Kritis", na: "N/A" };

function Dot({ light }: { light: Light }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", LIGHT_DOT[light])} />
      <span className="text-xs text-muted-foreground">{LIGHT_LABEL[light]}</span>
    </span>
  );
}

// KPI card ringkas untuk view Command.
function Kpi({ title, value, sub, tone, icon: Icon }: {
  title: string; value: string; sub?: string; tone?: "positive" | "negative" | "neutral";
  icon: typeof Activity;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub ? (
          <p className={cn("text-muted-foreground mt-1 text-xs",
            tone === "positive" && "text-emerald-600 dark:text-emerald-500",
            tone === "negative" && "text-destructive")}>{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Komponen utama ─────────────────────────────────────────────────
export function ExecutiveDashboard({ initial, initialView }: { initial: CommandData | null; initialView?: string }) {
  const startTab = (TABS.find((t) => t.key === initialView)?.key ?? "command") as ViewKey;
  const [tab, setTab] = useState<ViewKey>(startTab);
  const [cache, setCache] = useState<Record<string, unknown>>(initial ? { command: initial } : {});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (view: ViewKey, force = false) => {
    if (!force && cache[view]) return;
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/executive/${view}`);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => void load(tab, true)} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {err ? (
        <Card><CardContent className="py-6 text-sm text-destructive">Gagal memuat: {err}</CardContent></Card>
      ) : loading && !cur ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          {tab === "command" && <CommandView d={cur as CommandData | undefined} />}
          {tab === "am-radar" && <AmRadarView d={cur as AmRadarData | undefined} />}
          {tab === "outlet-matrix" && <OutletView d={cur as OutletData | undefined} />}
          {tab === "dormant-intel" && <DormantView d={cur as DormantIntelData | undefined} />}
          {tab === "rotation" && <RotationView d={cur as RotationData | undefined} />}
          {tab === "kpi-baseline" && <KpiView d={cur as KpiData | undefined} />}
        </>
      )}
    </div>
  );
}

// ── View 1: COMMAND ────────────────────────────────────────────────
function CommandView({ d }: { d: CommandData | undefined }) {
  if (!d) return null;
  const momTone = d.delta_mom_pct == null ? "neutral" : d.delta_mom_pct >= 0 ? "positive" : "negative";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi title="Revenue MTD" value={rpc(d.revenue_mtd)} icon={Activity}
          sub={d.target_mtd != null ? `Target ${rpc(d.target_mtd)} · ${pctStr(d.achievement_mtd_pct)}` : "Target belum diisi"}
          tone={d.achievement_mtd_pct != null && d.achievement_mtd_pct >= 90 ? "positive" : d.achievement_mtd_pct != null && d.achievement_mtd_pct < 75 ? "negative" : "neutral"} />
        <Kpi title="Revenue YTD" value={rpc(d.revenue_ytd)} icon={Target}
          sub={d.target_ytd != null ? `Target ${rpc(d.target_ytd)} · ${pctStr(d.achievement_ytd_pct)}` : "Target belum diisi"} />
        <Kpi title="Growth MoM" value={pctStr(d.delta_mom_pct)} icon={momTone === "negative" ? TrendingDown : TrendingUp}
          sub="vs bulan lalu" tone={momTone} />
        <Kpi title="AR > 90 hari" value={rpc(d.ar_over_90)} icon={Wallet}
          sub={d.ar_total != null ? `dari total AR ${rpc(d.ar_total)}` : undefined}
          tone={d.ar_over_90 && d.ar_over_90 > 0 ? "negative" : "neutral"} />
        <Kpi title="Customer Dormant" value={d.dormant_count != null ? numFmt.format(d.dormant_count) : "—"} icon={MoonStar}
          sub={d.dormant_value != null ? `nilai at-risk ${rpc(d.dormant_value)}` : undefined} tone="neutral" />
        <Kpi title="Red Flags (WatchPoint)" value={numFmt.format(d.red_flags_count)} icon={AlertTriangle}
          sub="metric HoD status merah" tone={d.red_flags_count > 0 ? "negative" : "positive"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" /> Top Risk
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {d.red_flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada red flag. 🎉</p>
            ) : d.red_flags.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                <div>
                  <p className="text-sm font-medium">{r.metric}</p>
                  <p className="text-xs text-muted-foreground">HoD {r.hod}</p>
                </div>
                <Badge variant="destructive">{r.pct != null ? `${r.pct}%` : "RED"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-emerald-500" /> Opportunities · Deal Negosiasi
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {d.opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada deal di stage Negosiasi.</p>
            ) : d.opportunities.map((o, i) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                <div>
                  <p className="text-sm font-medium">{o.customer ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{o.stage}{o.am_id ? ` · AM ${o.am_id}` : ""}</p>
                </div>
                <span className="text-sm font-semibold">{rpc(o.value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {d.range ? <p className="text-xs text-muted-foreground">Periode MTD: {d.range.from} – {d.range.to}</p> : null}
    </div>
  );
}

// ── View 2: AM RADAR ───────────────────────────────────────────────
type SortKey = "rank" | "total" | "achievement_pct";
function AmRadarView({ d }: { d: AmRadarData | undefined }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [asc, setAsc] = useState(true);
  if (!d) return null;

  const rows = [...d.rows].sort((a, b) => {
    const va = a[sortKey] ?? -Infinity, vb = b[sortKey] ?? -Infinity;
    return asc ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });
  const toggle = (k: SortKey) => { if (k === sortKey) setAsc(!asc); else { setSortKey(k); setAsc(k === "rank"); } };
  const arrow = (k: SortKey) => (k === sortKey ? (asc ? " ▲" : " ▼") : "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{d.summary.total} AM</Badge>
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{d.summary.green} On Track</Badge>
        <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">{d.summary.yellow} Perhatian</Badge>
        <Badge variant="destructive">{d.summary.red} Kritis</Badge>
        {d.summary.na > 0 ? <Badge variant="secondary">{d.summary.na} N/A</Badge> : null}
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
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggle("achievement_pct")}>Ach %{arrow("achievement_pct")}</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.rank}-${r.am_id ?? r.nama}`} className={cn(r.self && "bg-primary/5")}>
                  <TableCell className="text-muted-foreground">{r.rank}</TableCell>
                  <TableCell className="font-medium">{r.nama ?? "—"}{r.self ? <Badge variant="secondary" className="ml-2">Anda</Badge> : null}</TableCell>
                  <TableCell>{r.cabang ?? "—"}</TableCell>
                  <TableCell>{r.region}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpc(r.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.target != null ? rpc(r.target) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{pctStr(r.achievement_pct)}</TableCell>
                  <TableCell><Dot light={r.light} /></TableCell>
                </TableRow>
              ))}
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
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Total Customer" value={numFmt.format(d.summary.total_customers)} icon={Building2}
          sub={`${d.summary.active} aktif · ${d.summary.dormant} dormant`} />
        <Kpi title="Revenue Bulan Ini" value={rpc(d.summary.revenue_month)} icon={Activity} />
        <Kpi title="Konsentrasi Top-1" value={pctStr(d.concentration.top_share_pct)} icon={Target}
          sub={d.concentration.top_customer ?? undefined}
          tone={d.concentration.flag ? "negative" : "neutral"} />
        <Kpi title="Konsentrasi Top-5" value={pctStr(d.concentration.top5_share_pct)} icon={Target} />
      </div>
      {d.concentration.flag ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4" /> Risiko konsentrasi: <strong>{d.concentration.top_customer}</strong> menyumbang {pctStr(d.concentration.top_share_pct)} revenue (&gt;30%).
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Top 20 Customer by Revenue</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Cabang</TableHead>
                <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Bulan Ini</TableHead>
                <TableHead className="text-right">Share</TableHead><TableHead className="text-right">Faktur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.top_customers.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.cabang ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpc(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{rpc(c.this_month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pctStr(c.share_pct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.invoices}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Customer Dormant (&gt;60 hari)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead><TableHead>Cabang</TableHead>
                <TableHead className="text-right">Revenue Hist.</TableHead>
                <TableHead className="text-right">Order Terakhir</TableHead><TableHead className="text-right">Hari</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.dormant.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Tidak ada.</TableCell></TableRow>
              ) : d.dormant.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.cabang ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpc(c.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{c.last_date ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{c.days_since ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── View 5: DORMANT INTEL ──────────────────────────────────────────
function IntelSection<T>({ title, icon: Icon, items, empty, render }: {
  title: string; icon: typeof Activity; items: T[]; empty: string; render: (it: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4" /> {title}
          <Badge variant="secondary" className="ml-auto">{items.length}</Badge></CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : items.map(render)}
      </CardContent>
    </Card>
  );
}
function DormantView({ d }: { d: DormantIntelData | undefined }) {
  if (!d) return null;
  const row = (left: React.ReactNode, right: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0">{left}</div><div className="shrink-0 text-right">{right}</div>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <IntelSection title="Customer Baru (7 hari)" icon={Sparkles} items={d.new_customers}
        empty="Belum ada customer baru minggu ini."
        render={(c) => <div key={c.id}>{row(
          <><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.first_date} · {c.invoices} faktur</p></>,
          <span className="text-sm font-semibold">{rpc(c.total)}</span>)}</div>} />
      <IntelSection title="Reaktivasi (order setelah >60 hari)" icon={TrendingUp} items={d.reactivated}
        empty="Belum ada reaktivasi."
        render={(c) => <div key={c.id + c.reactivated_date}>{row(
          <><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.reactivated_date}</p></>,
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">senyap {c.gap_days} hari</Badge>)}</div>} />
      <IntelSection title="Suddenly Silent (30–60 hari)" icon={MoonStar} items={d.silent}
        empty="Tidak ada sinyal early-churn."
        render={(c) => <div key={c.id}>{row(
          <><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-muted-foreground">terakhir {c.last_date} · {c.invoices} faktur</p></>,
          <Badge variant="destructive">{c.days_since} hari</Badge>)}</div>} />
      <IntelSection title="Competitor Mentions" icon={Swords} items={d.competitor_mentions}
        empty="Belum ada mention kompetitor."
        render={(c) => <div key={c.id}>{row(
          <><p className="truncate text-sm font-medium">{c.vendor}{c.produk ? ` · ${c.produk}` : ""}</p><p className="truncate text-xs text-muted-foreground">{c.customer_name ?? "—"}{c.konteks ? ` — ${c.konteks}` : ""}</p></>,
          <span className="text-xs text-muted-foreground">{c.tanggal}</span>)}</div>} />
    </div>
  );
}

// ── View 6: ROTATION (F66 NPK — HoD readiness & promosi) ───────────
const READINESS_LABEL: Record<Readiness, string> = {
  "ready-to-scale": "Ready to Scale", stable: "Stable", "accelerated-dev": "Accelerated Dev",
  pip: "PIP", "belum-dinilai": "Belum Dinilai",
};
const READINESS_CLR: Record<Readiness, string> = {
  "ready-to-scale": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  stable: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "accelerated-dev": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pip: "bg-red-500/15 text-red-600 dark:text-red-400",
  "belum-dinilai": "bg-muted text-muted-foreground",
};
function RotationView({ d }: { d: RotationData | undefined }) {
  if (!d) return null;
  if (!d.accessible) {
    return (
      <Card><CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Info className="size-4" /> Data NPK bersifat sensitif (HR) — akun ini tidak berwenang melihat skor NPK seluruh HoD.
      </CardContent></Card>
    );
  }
  const perStr = (p: { year: number; period: string }) => `${p.period} ${p.year}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{d.summary.total} HoD · {perStr(d.period)}</Badge>
        <Badge className={READINESS_CLR["ready-to-scale"]}>{d.summary.ready} Ready to Scale</Badge>
        <Badge className={READINESS_CLR["stable"]}>{d.summary.stable} Stable</Badge>
        <Badge className={READINESS_CLR["accelerated-dev"]}>{d.summary.accel} Accelerated Dev</Badge>
        <Badge className={READINESS_CLR["pip"]}>{d.summary.pip} PIP</Badge>
        {d.summary.belum > 0 ? <Badge variant="secondary">{d.summary.belum} Belum Dinilai</Badge> : null}
      </div>
      {!d.computed ? (
        <Card><CardContent className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Info className="size-4" /> NPK {perStr(d.period)} belum di-compute — jalankan compute NPK dulu (menu NPK Direktur).
        </CardContent></Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpCircle className="size-4 text-emerald-500" /> Kandidat Promosi
            <Badge variant="secondary" className="ml-auto">{d.promotion_candidates.length}</Badge></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">NPK ≥75 dua semester berturut (SK Ps. 2.2)</p>
            {d.promotion_candidates.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada.</p>
              : d.promotion_candidates.map((r) => (
                <div key={r.hod_key} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <div><p className="text-sm font-medium">{r.hod_name}</p><p className="text-xs text-muted-foreground">{r.role}</p></div>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{r.npk} <span className="text-xs text-muted-foreground">(prev {r.npk_prev})</span></span>
                </div>))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4 text-emerald-500" /> Top Performer
            <Badge variant="secondary" className="ml-auto">{d.top_performers.length}</Badge></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">NPK ≥90 (Sangat Baik)</p>
            {d.top_performers.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada.</p>
              : d.top_performers.map((r) => (
                <div key={r.hod_key} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <p className="text-sm font-medium">{r.hod_name}</p>
                  <span className="text-sm font-semibold">{r.npk}</span>
                </div>))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" /> Underperformer
            <Badge variant="secondary" className="ml-auto">{d.underperformers.length}</Badge></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">NPK &lt;60 — perlu intervensi</p>
            {d.underperformers.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada.</p>
              : d.underperformers.map((r) => (
                <div key={r.hod_key} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <p className="text-sm font-medium">{r.hod_name}</p>
                  <span className="text-sm font-semibold text-destructive">{r.npk}</span>
                </div>))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="size-4" /> HoD Readiness</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HoD</TableHead><TableHead>Role</TableHead>
                <TableHead className="text-right">NPK</TableHead><TableHead className="text-right">{perStr(d.prev)}</TableHead>
                <TableHead>Predikat</TableHead><TableHead>Readiness</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.hod_key}>
                  <TableCell className="font-medium">{r.hod_name}{r.promotion_candidate ? <ArrowUpCircle className="ml-1.5 inline size-3.5 text-emerald-500" /> : null}</TableCell>
                  <TableCell className="text-muted-foreground">{r.role}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.available_count > 0 ? r.npk : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.npk_prev ?? "—"}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{r.available_count > 0 ? r.predikat.replace(/_/g, " ") : "—"}</TableCell>
                  <TableCell><Badge className={READINESS_CLR[r.readiness]}>{READINESS_LABEL[r.readiness]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── View 7: KPI BASELINE ───────────────────────────────────────────
function KpiView({ d }: { d: KpiData | undefined }) {
  if (!d) return null;
  const fmt = (v: number | null, unit: "IDR" | "%" | "count") =>
    v == null ? "—" : unit === "IDR" ? rpc(v) : unit === "%" ? `${v}%` : numFmt.format(v);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Per {d.as_of} · {d.note}</p>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>KPI</TableHead><TableHead>Formula</TableHead>
                <TableHead className="text-right">Target</TableHead><TableHead className="text-right">Aktual</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.kpis.map((k) => (
                <TableRow key={k.name}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{k.formula}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(k.target, k.unit)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmt(k.actual, k.unit)}</TableCell>
                  <TableCell><Dot light={k.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{k.trend == null ? "—" : (
                    <span className={cn(k.trend >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>
                      {k.trend >= 0 ? "▲" : "▼"} {Math.abs(k.trend)}%</span>)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
