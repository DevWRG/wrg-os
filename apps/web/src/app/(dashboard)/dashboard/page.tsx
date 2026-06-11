"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const cards: { label: string; value: number | string; sub: string; tone: string }[] = [
    { label: "Hari kerja", value: k.working_days, sub: "dalam rentang", tone: "text-info" },
    { label: "Karyawan wajib", value: k.users_wajib, sub: `dari ${k.users_aktif} aktif`, tone: "text-primary" },
    { label: "Total Plan", value: k.total_plan, sub: `${k.total_plan_visits} kunjungan + ${k.total_todo_items} todo`, tone: "text-primary" },
    { label: "Reported", value: k.reported, sub: `${k.completion}% selesai`, tone: "text-success" },
    { label: "Late submission", value: k.late, sub: "submit lewat batas", tone: "text-danger" },
    { label: "Aktivitas (report)", value: k.aktivitas, sub: "items report", tone: "text-info" },
    { label: "Unmatched report", value: k.unmatched, sub: "tidak match plan", tone: "text-warning" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium">{c.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-semibold tabular-nums", c.tone)}>{c.value}</div>
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
    const [s, t, p] = await Promise.all([
      getJson<{ kpi: Kpi }>(`/api/report/summary?${qs}`),
      getJson<{ days: TrendDay[] }>(`/api/report/daily-trend?${qs}`),
      getJson<Pending>(`/api/report/reminders-pending`),
    ]);
    setError(s ? null : "Gagal memuat ringkasan.");
    setKpi(s?.kpi ?? null);
    setTrend(t?.days ?? []);
    setPending(p);
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
                  <LineChart data={trend} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="tanggal" tickFormatter={dmy} tickLine={false} axisLine={false} minTickGap={24} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="plan" stroke="var(--color-plan)" strokeWidth={2} dot={false} />
                    <Line dataKey="report" stroke="var(--color-report)" strokeWidth={2} dot={false} />
                    <Line dataKey="late" stroke="var(--color-late)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Panggilan</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Cabang</TableHead>
                      <TableHead className="text-right">Hari</TableHead>
                      <TableHead className="text-right">Plan</TableHead>
                      <TableHead className="text-right">Report</TableHead>
                      <TableHead className="text-right">% Selesai</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">Unmatched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orang.map((r) => (
                      <TableRow key={r.am_id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">
                          <Link href={`/dashboard/drilldown?am_id=${r.am_id}&from=${range?.from}&to=${range?.to}`} className="hover:text-primary hover:underline">
                            {r.panggilan ?? r.am_id}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.nama}</TableCell>
                        <TableCell><Badge variant="outline">{r.role}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{r.cabang ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.active_days}</TableCell>
                        <TableCell className="text-right">{r.plan_count}</TableCell>
                        <TableCell className="text-right">{r.report_count}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctTone(r.completion))}>{pct(r.completion)}</TableCell>
                        <TableCell className="text-right">{r.late > 0 ? <span className="text-danger">{r.late}</span> : 0}</TableCell>
                        <TableCell className="text-right">{r.unmatched > 0 ? <span className="text-warning">{r.unmatched}</span> : 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : tab === "hod" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HOD</TableHead>
                      <TableHead>Nama Lengkap</TableHead>
                      <TableHead className="text-right">AM</TableHead>
                      <TableHead className="text-right">Submit</TableHead>
                      <TableHead className="text-right">Plan</TableHead>
                      <TableHead className="text-right">Reported</TableHead>
                      <TableHead className="text-right">% Selesai</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">Unmatched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hod.map((r) => (
                      <TableRow key={r.hod}>
                        <TableCell className="font-medium">{r.hod}</TableCell>
                        <TableCell className="text-muted-foreground">{r.hod_nama ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.jumlah_am}</TableCell>
                        <TableCell className="text-right">{r.am_submit}</TableCell>
                        <TableCell className="text-right">{r.plan_count}</TableCell>
                        <TableCell className="text-right">{r.report_count}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctTone(r.completion))}>{pct(r.completion)}</TableCell>
                        <TableCell className="text-right">{r.late}</TableCell>
                        <TableCell className="text-right">{r.unmatched}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tab === "divisi" ? "Divisi" : "Cabang"}</TableHead>
                      <TableHead className="text-right">Orang</TableHead>
                      <TableHead className="text-right">Plan</TableHead>
                      <TableHead className="text-right">Report</TableHead>
                      <TableHead className="text-right">% Selesai</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                      <TableHead className="text-right">Unmatched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.key}</TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right">{r.plan_count}</TableCell>
                        <TableCell className="text-right">{r.report_count}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctTone(r.completion))}>{pct(r.completion)}</TableCell>
                        <TableCell className="text-right">{r.late}</TableCell>
                        <TableCell className="text-right">{r.unmatched}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}
