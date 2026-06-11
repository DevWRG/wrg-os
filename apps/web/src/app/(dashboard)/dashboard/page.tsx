"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Area, CartesianGrid, ComposedChart, Line, XAxis } from "recharts";
import { Activity, AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Clock, UsersRound, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface Kpi {
  working_days: number;
  users_wajib: number;
  users_aktif: number;
  total_plan: number;
  total_plan_visits: number;
  total_todo_items: number;
  reported: number;
  completion: number;
  late: number;
  aktivitas: number;
  unmatched: number;
}
interface OrangRow {
  am_id: string;
  panggilan: string | null;
  nama: string;
  role: string;
  cabang: string | null;
  active_days: number;
  plan_count: number;
  report_count: number;
  late: number;
  unmatched: number;
  completion: number | null;
  is_am: boolean;
}
interface GroupRow {
  key: string;
  count: number;
  plan_count: number;
  report_count: number;
  late: number;
  unmatched: number;
  completion: number | null;
}
interface HodRow {
  hod: string;
  hod_nama: string | null;
  jumlah_am: number;
  am_submit: number;
  plan_count: number;
  report_count: number;
  late: number;
  unmatched: number;
  completion: number | null;
}
interface TrendDay {
  tanggal: string;
  is_working: boolean;
  holiday: string | null;
  plan: number;
  report: number;
  late: number;
}
interface Pending {
  date: string;
  am_pending: { pending: number; total: number };
  todo_pending: { pending: number; total: number };
  zero_submission: { pending: number };
}

type Tab = "orang" | "divisi" | "cabang" | "hod";
const TABS: { key: Tab; label: string }[] = [
  { key: "orang", label: "Per Orang" },
  { key: "divisi", label: "Per Divisi" },
  { key: "cabang", label: "Per Cabang" },
  { key: "hod", label: "Per HOD Sales" },
];

const trendConfig = {
  plan: { label: "Plan", color: "var(--chart-1)" },
  report: { label: "Report", color: "var(--chart-2)" },
  late: { label: "Late", color: "var(--chart-3)" },
} satisfies ChartConfig;

const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Kpis({ k }: { k: Kpi }) {
  const compTone = k.completion >= 80 ? "bg-success-soft text-success" : k.completion >= 50 ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger";
  const cards: { label: string; value: number | string; sub: string; icon: LucideIcon; chip: string; pill?: string; pillCls?: string }[] = [
    { label: "Hari kerja", value: k.working_days, sub: "dalam rentang", icon: CalendarDays, chip: "bg-info-soft text-info" },
    { label: "Karyawan wajib", value: k.users_wajib, sub: `dari ${k.users_aktif} aktif`, icon: UsersRound, chip: "bg-primary-soft text-primary" },
    { label: "Total Plan", value: k.total_plan, sub: `${k.total_plan_visits} kunjungan + ${k.total_todo_items} todo`, icon: ClipboardList, chip: "bg-primary-soft text-primary" },
    { label: "Reported", value: k.reported, sub: "dari plan terkirim", icon: CheckCircle2, chip: "bg-success-soft text-success", pill: `${k.completion}% selesai`, pillCls: compTone },
    { label: "Late submission", value: k.late, sub: "submit lewat batas", icon: Clock, chip: "bg-danger-soft text-danger", pill: k.late > 0 ? "perlu cek" : undefined, pillCls: "bg-danger-soft text-danger" },
    { label: "Aktivitas (report)", value: k.aktivitas, sub: "items report", icon: Activity, chip: "bg-info-soft text-info" },
    { label: "Unmatched report", value: k.unmatched, sub: "tidak match plan", icon: AlertTriangle, chip: "bg-warning-soft text-warning", pill: k.unmatched > 0 ? "tinjau" : undefined, pillCls: "bg-warning-soft text-warning" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2.5">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", c.chip)}>
                <c.icon className="size-4" />
              </div>
              <span className="text-muted-foreground text-xs leading-tight font-medium">{c.label}</span>
              {c.pill && <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", c.pillCls)}>{c.pill}</span>}
            </div>
            <div className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</div>
            <p className="text-muted-foreground text-xs">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const pctTone = (v: number | null) =>
  v === null ? "" : v >= 80 ? "text-success" : v >= 50 ? "text-warning" : "text-danger";

export default function DashboardPage() {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [today, setToday] = useState("");
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [trend, setTrend] = useState<TrendDay[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [tab, setTab] = useState<Tab>("orang");
  const [orang, setOrang] = useState<OrangRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [hod, setHod] = useState<HodRow[]>([]);
  const [cabangStat, setCabangStat] = useState<GroupRow[]>([]);
  const [reminderOpen, setReminderOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const d = await getJson<{ from: string; to: string; today: string }>("/api/report/range-default");
      if (d) {
        setRange({ from: d.from, to: d.to });
        setDraft({ from: d.from, to: d.to });
        setToday(d.today);
      } else {
        setError("Gagal memuat rentang default. Pastikan apps/api jalan.");
        setLoading(false);
      }
    })();
  }, []);

  const loadCore = useCallback(async (r: { from: string; to: string }) => {
    const qs = `from=${r.from}&to=${r.to}`;
    const [s, t, p, c] = await Promise.all([
      getJson<{ kpi: Kpi }>(`/api/report/summary?${qs}`),
      getJson<{ days: TrendDay[] }>(`/api/report/daily-trend?${qs}`),
      getJson<Pending>(`/api/report/reminders-pending`),
      getJson<{ rows: GroupRow[] }>(`/api/report/per-cabang?${qs}`),
    ]);
    setError(s ? null : "Gagal memuat ringkasan.");
    setKpi(s?.kpi ?? null);
    setTrend(t?.days ?? []);
    setPending(p);
    setCabangStat(c?.rows ?? []);
    setLoading(false);
  }, []);

  const loadTab = useCallback(async (t: Tab, r: { from: string; to: string }) => {
    const qs = `from=${r.from}&to=${r.to}`;
    if (t === "orang") {
      const d = await getJson<{ rows: OrangRow[] }>(`/api/report/per-orang?${qs}`);
      setOrang(d?.rows ?? []);
    } else if (t === "hod") {
      const d = await getJson<{ rows: HodRow[] }>(`/api/report/per-hod?${qs}`);
      setHod(d?.rows ?? []);
    } else {
      const d = await getJson<{ rows: GroupRow[] }>(`/api/report/per-${t}?${qs}`);
      setGroups(d?.rows ?? []);
    }
  }, []);

  useEffect(() => {
    if (!range) return;
    // Fetch on range change; semua setState terjadi di dalam loader async (setelah await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCore(range);
    void loadTab(tab, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  function apply() {
    if (draft.from && draft.to) {
      const r = draft.from <= draft.to ? draft : { from: draft.to, to: draft.from };
      setRange(r);
    }
  }
  function preset(kind: "today" | "week") {
    if (kind === "today") setDraft({ from: today, to: today });
    else void getJson<{ from: string; to: string }>("/api/report/range-default").then((d) => d && setDraft({ from: d.from, to: d.to }));
  }
  function selectTab(t: Tab) {
    setTab(t);
    if (range) void loadTab(t, range);
  }

  const showReminder =
    pending && (pending.am_pending.pending > 0 || pending.todo_pending.pending > 0 || pending.zero_submission.pending > 0);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {today && (
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              {new Date(today).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">Plan &amp; Report</h1>
          <p className="text-muted-foreground text-sm">
            Kepatuhan plan/report harian per karyawan {range ? `· ${range.from} → ${range.to}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={draft.from} onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} className="h-8 w-auto" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={draft.to} onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} className="h-8 w-auto" />
          <Button size="sm" variant="outline" onClick={() => preset("today")}>Hari ini</Button>
          <Button size="sm" variant="outline" onClick={() => preset("week")}>Minggu ini</Button>
          <Button size="sm" onClick={apply}>Terapkan</Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading && !kpi ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : kpi ? (
        <>
          <Kpis k={kpi} />

          {showReminder && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Belum Report Hari Ini · {pending?.date}</CardTitle>
                <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setReminderOpen((o) => !o)}>
                  {reminderOpen ? "Sembunyikan" : "Tampilkan"}
                </button>
              </CardHeader>
              {reminderOpen && pending && (
                <CardContent className="flex flex-wrap gap-2">
                  <span className="border-danger/30 bg-danger-soft text-danger inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm">
                    AM belum visit-report <b>{pending.am_pending.pending}</b>/{pending.am_pending.total}
                  </span>
                  <span className="border-warning/30 bg-warning-soft text-warning inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm">
                    Todo belum report <b>{pending.todo_pending.pending}</b>
                  </span>
                  <span className="border-info/30 bg-info-soft text-info inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm">
                    Zero submission <b>{pending.zero_submission.pending}</b>
                  </span>
                </CardContent>
              )}
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tren Plan &amp; Report Harian</CardTitle>
            </CardHeader>
            <CardContent>
              {trend.length === 0 ? (
                <p className="text-muted-foreground text-sm">Tidak ada data tren.</p>
              ) : (
                <ChartContainer config={trendConfig} className="h-64 w-full">
                  <ComposedChart data={trend} margin={{ left: 12, right: 12 }}>
                    <defs>
                      <linearGradient id="fillPlan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-plan)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-plan)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fillReport" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-report)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--color-report)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="tanggal" tickFormatter={dmy} tickLine={false} axisLine={false} minTickGap={24} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area dataKey="plan" type="monotone" stroke="var(--color-plan)" strokeWidth={2} fill="url(#fillPlan)" dot={false} />
                    <Area dataKey="report" type="monotone" stroke="var(--color-report)" strokeWidth={2} fill="url(#fillReport)" dot={false} />
                    <Line dataKey="late" type="monotone" stroke="var(--color-late)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </ComposedChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {cabangStat.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">Kepatuhan</p>
                <CardTitle className="text-sm font-medium">Per Cabang</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  {[...cabangStat]
                    .sort((a, b) => b.plan_count - a.plan_count)
                    .slice(0, 8)
                    .map((g) => {
                      const v = g.completion ?? 0;
                      const tone = g.completion === null ? "bg-muted-foreground" : v >= 80 ? "bg-success" : v >= 50 ? "bg-warning" : "bg-danger";
                      return (
                        <div key={g.key}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 font-medium">
                              <span className={cn("size-2 rounded-full", tone)} />
                              {g.key}
                            </span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {g.plan_count} plan · <span className="text-foreground font-medium">{v}%</span>
                            </span>
                          </div>
                          <div className="bg-muted mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
                            <div className={cn("h-full rounded-full", tone)} style={{ width: `${v}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-0">
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => selectTab(t.key)}
                    className={cn(
                      "rounded-lg border px-3 py-1 text-sm transition-colors",
                      tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {tab === "orang" ? (
                <DataTable
                  data={orang}
                  getKey={(r) => r.am_id}
                  searchPlaceholder="Cari nama / cabang / role…"
                  pageSize={25}
                  columns={[
                    { id: "panggilan", header: "Panggilan", sortable: true, accessor: (r) => r.panggilan ?? r.am_id, cell: (r) => <Link href={`/dashboard/drilldown?am_id=${r.am_id}&from=${range?.from}&to=${range?.to}`} className="font-medium hover:text-primary hover:underline">{r.panggilan ?? r.am_id}</Link> },
                    { id: "nama", header: "Nama", sortable: true, accessor: (r) => r.nama, cell: (r) => <span className="text-muted-foreground">{r.nama}</span> },
                    { id: "role", header: "Role", sortable: true, accessor: (r) => r.role, cell: (r) => <Badge variant="outline">{r.role}</Badge> },
                    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
                    { id: "hari", header: "Hari", align: "right", sortable: true, accessor: (r) => r.active_days },
                    { id: "plan", header: "Plan", align: "right", sortable: true, accessor: (r) => r.plan_count },
                    { id: "report", header: "Report", align: "right", sortable: true, accessor: (r) => r.report_count },
                    { id: "completion", header: "% Selesai", align: "right", sortable: true, accessor: (r) => r.completion ?? -1, cell: (r) => <span className={cn("font-medium", pctTone(r.completion))}>{pct(r.completion)}</span> },
                    { id: "late", header: "Late", align: "right", sortable: true, accessor: (r) => r.late, cell: (r) => (r.late > 0 ? <span className="text-danger">{r.late}</span> : 0) },
                    { id: "unmatched", header: "Unmatched", align: "right", sortable: true, accessor: (r) => r.unmatched, cell: (r) => (r.unmatched > 0 ? <span className="text-warning">{r.unmatched}</span> : 0) },
                  ] satisfies DataColumn<OrangRow>[]}
                />
              ) : tab === "hod" ? (
                <DataTable
                  data={hod}
                  getKey={(r) => r.hod}
                  searchPlaceholder="Cari HOD…"
                  pageSize={25}
                  columns={[
                    { id: "hod", header: "HOD", sortable: true, accessor: (r) => r.hod, cell: (r) => <span className="font-medium">{r.hod}</span> },
                    { id: "nama", header: "Nama Lengkap", sortable: true, accessor: (r) => r.hod_nama ?? "", cell: (r) => <span className="text-muted-foreground">{r.hod_nama ?? "—"}</span> },
                    { id: "am", header: "AM", align: "right", sortable: true, accessor: (r) => r.jumlah_am },
                    { id: "submit", header: "Submit", align: "right", sortable: true, accessor: (r) => r.am_submit },
                    { id: "plan", header: "Plan", align: "right", sortable: true, accessor: (r) => r.plan_count },
                    { id: "report", header: "Reported", align: "right", sortable: true, accessor: (r) => r.report_count },
                    { id: "completion", header: "% Selesai", align: "right", sortable: true, accessor: (r) => r.completion ?? -1, cell: (r) => <span className={cn("font-medium", pctTone(r.completion))}>{pct(r.completion)}</span> },
                    { id: "late", header: "Late", align: "right", sortable: true, accessor: (r) => r.late },
                    { id: "unmatched", header: "Unmatched", align: "right", sortable: true, accessor: (r) => r.unmatched },
                  ] satisfies DataColumn<HodRow>[]}
                />
              ) : (
                <DataTable
                  data={groups}
                  getKey={(r) => r.key}
                  searchPlaceholder={tab === "divisi" ? "Cari divisi…" : "Cari cabang…"}
                  pageSize={25}
                  columns={[
                    { id: "key", header: tab === "divisi" ? "Divisi" : "Cabang", sortable: true, accessor: (r) => r.key, cell: (r) => <span className="font-medium">{r.key}</span> },
                    { id: "count", header: "Orang", align: "right", sortable: true, accessor: (r) => r.count },
                    { id: "plan", header: "Plan", align: "right", sortable: true, accessor: (r) => r.plan_count },
                    { id: "report", header: "Report", align: "right", sortable: true, accessor: (r) => r.report_count },
                    { id: "completion", header: "% Selesai", align: "right", sortable: true, accessor: (r) => r.completion ?? -1, cell: (r) => <span className={cn("font-medium", pctTone(r.completion))}>{pct(r.completion)}</span> },
                    { id: "late", header: "Late", align: "right", sortable: true, accessor: (r) => r.late },
                    { id: "unmatched", header: "Unmatched", align: "right", sortable: true, accessor: (r) => r.unmatched },
                  ] satisfies DataColumn<GroupRow>[]}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}
