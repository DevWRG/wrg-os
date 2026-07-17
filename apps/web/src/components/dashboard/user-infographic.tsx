"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  MapPin,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DrilldownPlanTable, DrilldownUnmatchedTable } from "@/components/tables/drilldown-tables";

// ── Tipe respons /report/drilldown (lihat apps/api/src/repo/plandash.ts reportDrilldown) ──
interface PlanRow {
  tanggal: string;
  customer_name: string | null;
  tujuan: string | null;
  goal: string | null;
  reported: boolean;
  is_late_plan: boolean;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date_mismatch: boolean;
  hasil: string | null;
  next_action: string | null;
}
interface ReportItem {
  idx: number;
  task?: string;
  result?: string;
  status?: string;
}
interface TodoRow {
  tanggal: string;
  items: string[];
  total_items: number;
  reported: boolean;
  is_late_plan: boolean;
  report_data: ReportItem[] | null;
}
interface UnmatchedRow {
  tanggal: string;
  customer_name: string | null;
  hasil: string | null;
  next_action: string | null;
}
interface DetailUser {
  am_id: string;
  nama: string;
  panggilan: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  wa_number: string | null;
}
interface Detail {
  user: DetailUser | null;
  plan: PlanRow[];
  todo: TodoRow[];
  unmatched: UnmatchedRow[];
}

// Bounding box Indonesia — replikasi apps/api/src/repo/visit.ts (verifyGeo).
const ID_LAT_MIN = -11;
const ID_LAT_MAX = 6;
const ID_LON_MIN = 95;
const ID_LON_MAX = 141;
type GeoStatus = "ok" | "out_of_bounds" | "date_mismatch" | "no_geo";
function geoOf(p: PlanRow): GeoStatus {
  if (p.visit_lat === null || p.visit_lon === null) return "no_geo";
  if (p.visit_date_mismatch) return "date_mismatch";
  if (p.visit_lat < ID_LAT_MIN || p.visit_lat > ID_LAT_MAX || p.visit_lon < ID_LON_MIN || p.visit_lon > ID_LON_MAX) {
    return "out_of_bounds";
  }
  return "ok";
}

const isoToday = () => new Date().toISOString().slice(0, 10);
const ALL_FROM = "2000-01-01";
const TODO_PAGE_SIZE = 5;

const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};
const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const monLabel = (ym: string) => {
  const d = new Date(`${ym}-01`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
};

const compTone = (v: number | null) =>
  v === null ? "text-muted-foreground" : v >= 80 ? "text-success" : v >= 50 ? "text-warning" : "text-danger";
const compFill = (v: number | null) =>
  v === null ? "var(--muted)" : v >= 80 ? "var(--chart-1)" : v >= 50 ? "var(--chart-4)" : "var(--chart-3)";

const statusTone = (s?: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "matched" ? "secondary" : s === "unmatched" ? "destructive" : "outline";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Donut dgn teks tengah (pola CenterDonut overview-dashboard.tsx).
function CenterDonut({
  slices,
  center,
  sub,
  centerCls,
}: {
  slices: { name: string; value: number; fill: string }[];
  center: string;
  sub?: string;
  centerCls?: string;
}) {
  const total = slices.reduce((a, b) => a + b.value, 0);
  return (
    <div className="relative">
      <ChartContainer config={{}} className="mx-auto h-40 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
          <Pie
            data={total > 0 ? slices : [{ name: "—", value: 1, fill: "var(--muted)" }]}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={72}
            startAngle={90}
            endAngle={-270}
            paddingAngle={2}
            cornerRadius={4}
          >
            {(total > 0 ? slices : [{ fill: "var(--muted)" }]).map((s, i) => (
              <Cell key={i} fill={s.fill} stroke="none" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center">
        <span className={cn("text-3xl font-semibold tabular-nums", centerCls)}>{center}</span>
        {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; value: number; fill: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className="size-2 rounded-full" style={{ background: it.fill }} />
          {it.label} <span className="text-foreground tabular-nums">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", tone ?? "bg-muted text-muted-foreground")}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground truncate text-xs">{label}</div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const trendConfig = {
  plan: { label: "Plan", color: "var(--chart-2)" },
  report: { label: "Report", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function UserInfographic({ amId, initialFrom, initialTo }: { amId: string; initialFrom?: string; initialTo?: string }) {
  const [range, setRange] = useState<{ from: string; to: string }>({
    from: initialFrom || ALL_FROM,
    to: initialTo || isoToday(),
  });
  const [draft, setDraft] = useState<{ from: string; to: string }>(range);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [todoPage, setTodoPage] = useState(0);

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    const d = await getJson<{ detail: Detail }>(
      `/api/report/drilldown?am_id=${encodeURIComponent(amId)}&from=${r.from}&to=${r.to}`,
    );
    setError(d ? null : "Gagal memuat data. Pastikan apps/api jalan.");
    setDetail(d?.detail ?? null);
    setTodoPage(0);
    setLoading(false);
  }, [amId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  function apply() {
    if (draft.from && draft.to) setRange(draft.from <= draft.to ? draft : { from: draft.to, to: draft.from });
  }
  function preset(kind: "all" | "month" | "week") {
    const today = isoToday();
    if (kind === "all") setDraft({ from: ALL_FROM, to: today });
    else if (kind === "month") setDraft({ from: today.slice(0, 8) + "01", to: today });
    else {
      const now = new Date();
      const dow = now.getUTCDay();
      const mon = new Date(now);
      mon.setUTCDate(now.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
      setDraft({ from: mon.toISOString().slice(0, 10), to: today });
    }
  }

  const u = detail?.user ?? null;
  const isAM = u?.role === "AM";

  // ── Metrik dihitung dari rows (branch role) ──
  const m = useMemo(() => {
    const plan = detail?.plan ?? [];
    const todo = detail?.todo ?? [];
    const unmatched = detail?.unmatched ?? [];
    const days = new Set<string>();
    plan.forEach((p) => days.add(p.tanggal));
    todo.forEach((t) => days.add(t.tanggal));
    unmatched.forEach((x) => days.add(x.tanggal));

    if (isAM) {
      const planCount = plan.length;
      const reportCount = plan.filter((p) => p.reported).length;
      const late = plan.filter((p) => p.is_late_plan).length;
      // Status donut: reported / late(belum) / pending — mutually exclusive.
      const reported = reportCount;
      const lateOnly = plan.filter((p) => !p.reported && p.is_late_plan).length;
      const pending = planCount - reported - lateOnly;
      // Geo visit dari plan rows.
      const geo: Record<GeoStatus, number> = { ok: 0, out_of_bounds: 0, date_mismatch: 0, no_geo: 0 };
      plan.forEach((p) => geo[geoOf(p)]++);
      return {
        planCount,
        reportCount,
        late,
        unmatched: unmatched.length,
        activeDays: days.size,
        completion: planCount > 0 ? Math.round((reportCount / planCount) * 100) : null,
        status: [
          { name: "Reported", value: reported, fill: "var(--chart-1)" },
          { name: "Late", value: lateOnly, fill: "var(--chart-3)" },
          { name: "Belum report", value: Math.max(0, pending), fill: "var(--muted)" },
        ],
        geo,
      };
    }
    // non-AM → todo
    let items = 0;
    let matched = 0;
    let unm = 0;
    todo.forEach((t) => {
      items += t.total_items;
      const rd = Array.isArray(t.report_data) ? t.report_data : [];
      matched += rd.filter((e) => e.status === "matched").length;
      unm += rd.filter((e) => e.status === "ambiguous" || e.status === "unmatched").length;
    });
    const belum = Math.max(0, items - matched - unm);
    return {
      planCount: items,
      reportCount: matched,
      late: todo.filter((t) => t.is_late_plan).length,
      unmatched: unm,
      activeDays: days.size,
      completion: items > 0 ? Math.round((matched / items) * 100) : null,
      status: [
        { name: "Matched", value: matched, fill: "var(--chart-1)" },
        { name: "Unmatched", value: unm, fill: "var(--chart-4)" },
        { name: "Belum report", value: belum, fill: "var(--muted)" },
      ],
      geo: null as Record<GeoStatus, number> | null,
    };
  }, [detail, isAM]);

  // ── Tren harian/bulanan (bucket per bulan jika span > 92 hari) ──
  const trend = useMemo(() => {
    const plan = detail?.plan ?? [];
    const todo = detail?.todo ?? [];
    const spanDays = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000;
    const monthly = spanDays > 92;
    const key = (iso: string) => (monthly ? iso.slice(0, 7) : iso);
    const map = new Map<string, { plan: number; report: number }>();
    const bump = (iso: string, p: number, r: number) => {
      const k = key(iso);
      const g = map.get(k) ?? { plan: 0, report: 0 };
      g.plan += p;
      g.report += r;
      map.set(k, g);
    };
    if (isAM) {
      plan.forEach((p) => bump(p.tanggal, 1, p.reported ? 1 : 0));
    } else {
      todo.forEach((t) => {
        const rd = Array.isArray(t.report_data) ? t.report_data : [];
        bump(t.tanggal, t.total_items, rd.filter((e) => e.status === "matched").length);
      });
    }
    const rows = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ bucket: k, ...v }));
    return { monthly, rows };
  }, [detail, range, isAM]);

  const geoSlices = m.geo
    ? [
        { name: "OK", value: m.geo.ok, fill: "var(--chart-1)" },
        { name: "Luar wilayah", value: m.geo.out_of_bounds, fill: "var(--chart-3)" },
        { name: "Beda tanggal", value: m.geo.date_mismatch, fill: "var(--chart-4)" },
        { name: "Tanpa geotag", value: m.geo.no_geo, fill: "var(--muted)" },
      ].filter((s) => s.value > 0)
    : [];

  const rangeIsAll = range.from === ALL_FROM;

  return (
    <div className="space-y-4">
      {/* Identitas + filter rentang */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{u?.panggilan ?? amId}</h1>
            {u && <Badge variant="outline">{u.role}{u.posisi ? ` · ${u.posisi}` : ""}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {u ? `${u.nama}${u.cabang ? ` · ${u.cabang}` : ""}` : amId}
            {" · "}
            {rangeIsAll ? "semua data" : `${range.from} → ${range.to}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={draft.from} onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} className="bg-card h-8 w-auto" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={draft.to} onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} className="bg-card h-8 w-auto" />
          <Button size="sm" variant="outline" onClick={() => preset("all")}>Semua data</Button>
          <Button size="sm" variant="outline" onClick={() => preset("month")}>Bulan ini</Button>
          <Button size="sm" variant="outline" onClick={() => preset("week")}>Minggu ini</Button>
          <Button size="sm" onClick={apply}>Terapkan</Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading && !detail ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : !detail ? (
        <p className="text-muted-foreground">Data tidak tersedia.</p>
      ) : !u ? (
        <p className="text-muted-foreground">User <code>{amId}</code> tidak ditemukan.</p>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icon={<ClipboardList className="size-4" />} label={isAM ? "Plan kunjungan" : "Item todo"} value={String(m.planCount)} tone="bg-primary-soft text-primary" />
            <Kpi icon={<CheckCircle2 className="size-4" />} label="Reported" value={String(m.reportCount)} tone="bg-success-soft text-success" />
            <Kpi icon={<Clock className="size-4" />} label="Late" value={String(m.late)} tone="bg-danger-soft text-danger" />
            <Kpi icon={<AlertTriangle className="size-4" />} label="Unmatched" value={String(m.unmatched)} tone="bg-warning-soft text-warning" />
            <Kpi icon={<CalendarDays className="size-4" />} label="Hari aktif" value={String(m.activeDays)} tone="bg-info-soft text-info" />
          </div>

          {/* Gauge + status donut */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Tingkat Penyelesaian</CardTitle>
              </CardHeader>
              <CardContent>
                <CenterDonut
                  slices={[
                    { name: "Selesai", value: m.reportCount, fill: compFill(m.completion) },
                    { name: "Belum", value: Math.max(0, m.planCount - m.reportCount), fill: "var(--muted)" },
                  ]}
                  center={m.completion === null ? "—" : `${m.completion}%`}
                  sub={`${m.reportCount} / ${m.planCount} ${isAM ? "kunjungan" : "item"}`}
                  centerCls={compTone(m.completion)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Status {isAM ? "Kunjungan" : "Todo"}</CardTitle>
              </CardHeader>
              <CardContent>
                <CenterDonut slices={m.status} center={String(m.planCount)} sub={isAM ? "kunjungan" : "item"} />
                <Legend items={m.status.map((s) => ({ label: s.name, value: s.value, fill: s.fill }))} />
              </CardContent>
            </Card>
          </div>

          {/* Tren */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Tren Plan &amp; Report {trend.monthly ? "(per bulan)" : "(per hari)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trend.rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">Tidak ada data pada rentang ini.</p>
              ) : (
                <ChartContainer config={trendConfig} className="h-56 w-full">
                  <AreaChart data={trend.rows} margin={{ left: 12, right: 12 }}>
                    <defs>
                      <linearGradient id="ugPlan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-plan)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-plan)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="ugReport" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-report)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-report)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket"
                      tickFormatter={trend.monthly ? monLabel : dmy}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area dataKey="plan" type="monotone" stroke="var(--color-plan)" strokeWidth={2} fill="url(#ugPlan)" dot={false} />
                    <Area dataKey="report" type="monotone" stroke="var(--color-report)" strokeWidth={2} fill="url(#ugReport)" dot={false} />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Panel role-spesifik */}
          {isAM ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="size-4" /> Kepatuhan Geotag Kunjungan
                </CardTitle>
              </CardHeader>
              <CardContent>
                {geoSlices.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Belum ada kunjungan dengan geotag pada rentang ini.</p>
                ) : (
                  <>
                    <CenterDonut
                      slices={geoSlices}
                      center={String(m.geo?.ok ?? 0)}
                      sub="geotag OK"
                    />
                    <Legend items={geoSlices.map((s) => ({ label: s.name, value: s.value, fill: s.fill }))} />
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            detail.todo.length > 0 && (() => {
              const pageCount = Math.max(1, Math.ceil(detail.todo.length / TODO_PAGE_SIZE));
              const cur = Math.min(todoPage, pageCount - 1);
              const slice = detail.todo.slice(cur * TODO_PAGE_SIZE, cur * TODO_PAGE_SIZE + TODO_PAGE_SIZE);
              return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Activity className="size-4" /> Todo / Plan Harian ({detail.todo.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {slice.map((t) => {
                    const rd = Array.isArray(t.report_data) ? t.report_data : [];
                    const byIdx = new Map(rd.map((r) => [r.idx, r]));
                    return (
                      <div key={t.tanggal} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm">
                          <span className="font-medium">{tgl(t.tanggal)}</span>
                          <span className="text-muted-foreground">{t.total_items} item</span>
                          {t.is_late_plan && <Badge variant="destructive">late</Badge>}
                          {t.reported ? <Badge variant="secondary">reported</Badge> : <Badge variant="outline">belum report</Badge>}
                        </div>
                        <ol className="space-y-1 text-sm">
                          {t.items.map((it, j) => {
                            const r = byIdx.get(j + 1);
                            return (
                              <li key={j} className="flex items-start gap-2">
                                <span className="text-muted-foreground tabular-nums">{j + 1}.</span>
                                <span className="flex-1">
                                  {it}
                                  {r?.result && <span className="text-muted-foreground"> → {r.result}</span>}
                                </span>
                                {r?.status && <Badge variant={statusTone(r.status)}>{r.status}</Badge>}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    );
                  })}
                  {pageCount > 1 && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <span className="text-muted-foreground text-xs">Hal {cur + 1}/{pageCount}</span>
                      <button
                        type="button"
                        onClick={() => setTodoPage((p) => Math.max(0, p - 1))}
                        disabled={cur === 0}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setTodoPage((p) => Math.min(pageCount - 1, p + 1))}
                        disabled={cur >= pageCount - 1}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })()
          )}

          {/* Detail tabel (collapsible) */}
          {(detail.plan.length > 0 || detail.unmatched.length > 0) && (
            <div className="space-y-4">
              <Button variant="outline" size="sm" onClick={() => setShowDetail((s) => !s)}>
                {showDetail ? "Sembunyikan detail" : "Tampilkan detail"}
              </Button>
              {showDetail && (
                <>
                  {detail.plan.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Plan Kunjungan ({detail.plan.length})</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DrilldownPlanTable plan={detail.plan} />
                      </CardContent>
                    </Card>
                  )}
                  {detail.unmatched.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Aktivitas di luar plan / unmatched ({detail.unmatched.length})</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DrilldownUnmatchedTable rows={detail.unmatched} />
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
