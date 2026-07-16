"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// ── Tipe (selaras /digests & /digests/stats) ──
interface Rekap {
  id: string; group_jid: string; group_name: string | null;
  period_start: string; period_end: string; model_used: string | null;
  raw_output: string; created_at: string;
}
interface Resume {
  id: string; period_date: string; period_type: string;
  model_used: string | null; raw_output: string; created_at: string;
}
export interface History { rekaps: Rekap[]; resumes: Resume[] }

interface Insights {
  meta: {
    days: number; total: number; lastAt: string | null;
    byKind: { kind: string; count: number }[];
    timeline: Array<Record<string, string | number>>;
    byHour: { hour: string; count: number }[];
  };
  ops: {
    days: number; wajibTotal: number;
    daily: Array<{
      tanggal: string; anggota_aktif: number; anggota_plan: number;
      total_report: number; matched: number; unmatched: number;
    }>;
  };
}

// Urutan kategori TETAP (jangan di-cycle) → warna --chart-1..5 dipetakan konsisten.
const KINDS = ["rekap", "resume", "daily", "weekly", "briefing"] as const;
const KIND_LABEL: Record<string, string> = {
  rekap: "Rekap", resume: "Resume", daily: "Daily", weekly: "Weekly", briefing: "Briefing",
};
const KIND_COLOR: Record<string, string> = {
  rekap: "var(--chart-1)", resume: "var(--chart-2)", daily: "var(--chart-3)",
  weekly: "var(--chart-4)", briefing: "var(--chart-5)",
};

const dt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const shortDay = (ymd: string) => {
  const [, m, dd] = ymd.split("-");
  return dd && m ? `${dd}/${m}` : ymd;
};

export function DigestsView({ history }: { history: History | null }) {
  const [tab, setTab] = useState<"riwayat" | "infografis">("riwayat");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {([["riwayat", "Riwayat"], ["infografis", "Infografis"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "riwayat" ? <Riwayat history={history} /> : <Infografis />}
    </div>
  );
}

// ── Tab: Riwayat (kartu teks — perilaku lama) ──
function Output({ text }: { text: string }) {
  return (
    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
      {text || "(kosong)"}
    </pre>
  );
}

function Riwayat({ history }: { history: History | null }) {
  if (!history) {
    return (
      <p className="text-muted-foreground">
        Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Resume Eksekutif{" "}
          <span className="text-muted-foreground text-sm font-normal">({history.resumes.length})</span>
        </h2>
        {history.resumes.length === 0 ? (
          <p className="text-muted-foreground text-sm">Belum ada resume tersimpan.</p>
        ) : (
          history.resumes.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {r.period_date}{" "}
                  <Badge variant="outline" className="ml-1">{r.period_type}</Badge>
                </CardTitle>
                <span className="text-muted-foreground text-xs">{r.model_used ?? "—"} · {dt(r.created_at)}</span>
              </CardHeader>
              <CardContent><Output text={r.raw_output} /></CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Rekap{" "}
          <span className="text-muted-foreground text-sm font-normal">({history.rekaps.length})</span>
        </h2>
        {history.rekaps.length === 0 ? (
          <p className="text-muted-foreground text-sm">Belum ada rekap tersimpan.</p>
        ) : (
          history.rekaps.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{r.group_name ?? r.group_jid}</CardTitle>
                <span className="text-muted-foreground text-xs">{r.model_used ?? "—"} · {dt(r.created_at)}</span>
              </CardHeader>
              <CardContent><Output text={r.raw_output} /></CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

// ── Tab: Infografis ──
const RANGES = [7, 30, 90] as const;

function Infografis() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Insights | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/digests/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Insights) => {
        if (!alive) return;
        setData(d);
        setState("idle");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [days]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Metadata dari <code>monitor_digest</code>; metrik aktivitas dihitung ulang dari sumber
          (kunjungan &amp; plan) — bukan parsing teks.
        </p>
        <div className="flex gap-1 rounded-lg border p-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {d} hari
            </button>
          ))}
        </div>
      </div>

      {state === "error" ? (
        <p className="text-muted-foreground">Gagal memuat infografis.</p>
      ) : state === "loading" && !data ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : data ? (
        <InfografisBody data={data} />
      ) : null}
    </div>
  );
}

function InfografisBody({ data }: { data: Insights }) {
  const { meta, ops } = data;

  const kpi = useMemo(() => {
    const inRange = meta.timeline.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const reported = ops.daily.filter((d) => d.total_report > 0);
    const complAvg = reported.length
      ? reported.reduce((s, d) => s + d.matched / d.total_report, 0) / reported.length
      : 0;
    const active = ops.daily.filter((d) => d.anggota_aktif > 0);
    const aktifAvg = active.length
      ? active.reduce((s, d) => s + d.anggota_aktif, 0) / active.length
      : 0;
    return { inRange, complAvg, aktifAvg };
  }, [meta.timeline, ops.daily]);

  const donut = useMemo(
    () =>
      meta.byKind
        .filter((k) => k.count > 0)
        .map((k) => ({
          name: KIND_LABEL[k.kind] ?? k.kind,
          value: k.count,
          fill: KIND_COLOR[k.kind] ?? "var(--muted)",
        })),
    [meta.byKind],
  );
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);

  const timeline = useMemo(
    () => meta.timeline.map((r) => ({ ...r, label: shortDay(String(r.tanggal)) })),
    [meta.timeline],
  );
  const opsData = useMemo(
    () => ops.daily.map((d) => ({ ...d, label: shortDay(d.tanggal) })),
    [ops.daily],
  );

  const timelineConfig = Object.fromEntries(
    KINDS.map((k) => [k, { label: KIND_LABEL[k], color: KIND_COLOR[k] }]),
  ) satisfies ChartConfig;
  const opsConfig = {
    anggota_aktif: { label: "AM aktif", color: "var(--chart-1)" },
    anggota_plan: { label: "AM berencana", color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const qualityConfig = {
    matched: { label: "Cocok plan", color: "var(--chart-1)" },
    unmatched: { label: "Di luar plan", color: "var(--chart-4)" },
  } satisfies ChartConfig;
  const hourConfig = { count: { label: "Digest", color: "var(--chart-2)" } } satisfies ChartConfig;

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total digest (all-time)" value={meta.total.toLocaleString("id-ID")} />
        <Kpi label={`Digest ${meta.days} hari`} value={kpi.inRange.toLocaleString("id-ID")} />
        <Kpi label="AM aktif / hari (rata²)" value={kpi.aktifAvg.toFixed(1)} sub={`dari ${ops.wajibTotal} wajib`} />
        <Kpi label="Compliance rata²" value={`${Math.round(kpi.complAvg * 100)}%`} sub="laporan cocok plan" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Timeline stacked per kind */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Digest per hari (per jenis)</CardTitle></CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <Empty />
            ) : (
              <ChartContainer config={timelineConfig} className="aspect-auto h-[240px] w-full">
                <BarChart data={timeline} margin={{ left: 4, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {KINDS.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={`var(--color-${k})`}
                      radius={i === KINDS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Donut per kind */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Komposisi jenis</CardTitle></CardHeader>
          <CardContent>
            {donutTotal === 0 ? (
              <Empty />
            ) : (
              <>
                <ChartContainer config={{}} className="mx-auto aspect-square h-[180px]">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius={45} strokeWidth={2}>
                      {donut.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                  {donut.map((d) => (
                    <span key={d.name} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm" style={{ background: d.fill }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-medium tabular-nums">{d.value}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Tren aktivitas: aktif vs plan */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tren aktivitas AM</CardTitle></CardHeader>
          <CardContent>
            {opsData.length === 0 ? (
              <Empty />
            ) : (
              <ChartContainer config={opsConfig} className="aspect-auto h-[220px] w-full">
                <LineChart data={opsData} margin={{ left: 4, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line dataKey="anggota_plan" type="monotone" stroke="var(--color-anggota_plan)" strokeWidth={2} dot={false} />
                  <Line dataKey="anggota_aktif" type="monotone" stroke="var(--color-anggota_aktif)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Kualitas laporan: matched vs unmatched */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Kualitas laporan</CardTitle></CardHeader>
          <CardContent>
            {opsData.length === 0 ? (
              <Empty />
            ) : (
              <ChartContainer config={qualityConfig} className="aspect-auto h-[220px] w-full">
                <BarChart data={opsData} margin={{ left: 4, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="matched" stackId="q" fill="var(--color-matched)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="unmatched" stackId="q" fill="var(--color-unmatched)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Jam terbit digest */}
      {meta.byHour.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Jam terbit digest (WIB)</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={hourConfig} className="aspect-auto h-[160px] w-full">
              <BarChart data={meta.byHour.map((h) => ({ ...h, label: `${h.hour}:00` }))} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="text-muted-foreground py-8 text-center text-sm">Belum ada data untuk rentang ini.</p>;
}
