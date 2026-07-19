"use client";

import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Scatter, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PeriodPicker, defaultPeriod } from "@/components/raport/period-picker";

// ── Tipe (selaras apps/api getRaportDetail) ──
interface ScorePart { key: string; label: string; score: number | null; weight: number; eff_weight: number }
interface KpiRow { id: string; name: string; target: string | null; perspective: string | null; achievement_pct: number | null }
export interface RaportDetail {
  linked?: boolean;
  message?: string;
  found?: boolean;
  period: string;
  period_label?: string;
  employee: { am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; is_am: boolean; spine_id: string | null };
  score: { overall: number | null; rating: string; parts: ScorePart[] };
  plan_report: { plan_count: number; report_count: number; completion: number | null; active_days: number; late: number; unmatched: number; expected: number; on_time: number; late_days: number; miss: number; compliance_rate: number | null } | null;
  bsc: { score: number | null; persp: Record<string, number>; objectives: Record<string, string[]>; kpi: KpiRow[] } | null;
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
  narrative: {
    verdict: string | null; headline: string | null;
    pantas_puas: string[]; penahan: string[]; bsc: Record<string, string>;
    akar_masalah: string; catatan_adil: string; ringkasan: string; predikat: string;
    model: string | null; generated_at: string | null;
  } | null;
  context_note: string;
}

const PERSPS = [
  { key: "fin", label: "Perspektif Keuangan", accent: "var(--chart-2)" },
  { key: "cust", label: "Perspektif Pelanggan Internal", accent: "var(--chart-1)" },
  { key: "proc", label: "Perspektif Proses Internal", accent: "var(--chart-5)" },
  { key: "learn", label: "Perspektif Pembelajaran", accent: "var(--chart-4)" },
] as const;

const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const shortDay = (ymd: string) => { const [, m, d] = ymd.split("-"); return d && m ? `${d}/${m}` : ymd; };

const gradeOf = (s: number | null): string =>
  s == null ? "—" : s >= 93 ? "A" : s >= 88 ? "A-" : s >= 83 ? "B+" : s >= 78 ? "B" : s >= 73 ? "B-" : s >= 65 ? "C+" : s >= 55 ? "C" : "D";
const zoneOf = (s: number | null): string => (s == null ? "—" : s >= 83 ? "Puas" : s >= 70 ? "Cukup" : "Tidak Puas");
const scoreTone = (s: number | null) =>
  s == null ? "text-muted-foreground" : s >= 95 ? "text-emerald-600" : s >= 80 ? "text-amber-600" : "text-red-600";
const barColor = (s: number | null) => (s == null ? "var(--muted)" : s >= 95 ? "var(--chart-1)" : s >= 80 ? "var(--chart-4)" : "var(--chart-3)");
const perspBadge = (s: number) =>
  s >= 95 ? { t: "Sangat Baik", c: "text-emerald-600" } : s >= 80 ? { t: "Baik", c: "text-emerald-600" } : s >= 65 ? { t: "Berkembang", c: "text-amber-600" } : { t: "Perlu Perhatian", c: "text-red-600" };

export function RaportView({ endpoint }: { endpoint: string }) {
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [data, setData] = useState<RaportDetail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch raport saat ganti periode; disengaja.
    setState("loading");
    fetch(`${endpoint}?period=${period}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RaportDetail) => { if (alive) { setData(d); setState("idle"); } })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [endpoint, period]);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>
      {state === "error" ? (
        <p className="text-muted-foreground">Gagal memuat raport.</p>
      ) : data?.linked === false ? (
        <Card><CardContent className="text-muted-foreground py-8 text-center text-sm">{data.message ?? "Akun belum tertaut ke data karyawan."}</CardContent></Card>
      ) : state === "loading" && !data ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : data && data.found !== false && data.employee ? (
        <Body data={data} />
      ) : (
        <p className="text-muted-foreground text-sm">Data raport tidak tersedia.</p>
      )}
    </div>
  );
}

function Body({ data }: { data: RaportDetail }) {
  const { employee: e, score, plan_report: pr, bsc, okr, raci, pdca, daily, workload, items, absensi, coaching, revenue, ar, narrative } = data;
  const prCount = score.parts.filter((p) => p.score != null && p.score < 80).length;

  return (
    <div className="space-y-5">
      <Hero e={e} score={score} periodLabel={data.period_label} pr={pr} workload={workload} prCount={prCount} />
      <StatRow pr={pr} workload={workload} absensi={absensi} />
      {bsc ? <Scorecard bsc={bsc} /> : null}
      {items.total > 0 ? <CategoryStatus items={items} /> : null}
      {daily.length ? <DailyChart daily={daily} /> : null}
      {bsc && bsc.kpi.length ? <OkrBlock okr={okr} kpi={bsc.kpi} /> : okr && (okr.objective || okr.key_results.length) ? <OkrTextOnly okr={okr} /> : null}
      {pdca ? <Pdca pdca={pdca} /> : null}
      {e.is_am && revenue ? <RevenueAr revenue={revenue} ar={ar} /> : null}
      {raci.length ? <Raci raci={raci} /> : null}
      {items.failures.length || items.blockers.length ? <FailBlock items={items} narrative={narrative} /> : null}
      <Absensi absensi={absensi} />
      {coaching ? <Coaching coaching={coaching} /> : null}
      {narrative ? <Kesimpulan narrative={narrative} nama={e.panggilan || e.nama} /> : (
        <p className="text-muted-foreground px-1 text-xs">Narasi AI (Kesimpulan) belum tersedia untuk periode ini — dijadwalkan otomatis tiap malam.</p>
      )}
      <p className="text-muted-foreground px-1 text-xs">{data.context_note}</p>
    </div>
  );
}

// ── Hero: grade + rating + indeks gauge ──
function Hero({ e, score, periodLabel, pr, workload, prCount }: {
  e: RaportDetail["employee"]; score: RaportDetail["score"]; periodLabel?: string;
  pr: RaportDetail["plan_report"]; workload: RaportDetail["workload"]; prCount: number;
}) {
  const s = score.overall;
  const pct = Math.max(0, Math.min(100, s ?? 0));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="from-primary bg-primary text-primary-foreground relative overflow-hidden rounded-xl bg-gradient-to-br to-blue-700 p-6 lg:col-span-2">
        <div className="text-primary-foreground/70 text-xs font-medium tracking-wide">
          PENILAIAN KINERJA · {e.nama.toUpperCase()}{periodLabel ? ` · ${periodLabel.toUpperCase()}` : ""}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="text-6xl font-bold leading-none">{gradeOf(s)}</div>
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">
              <span className="size-2 rounded-full bg-emerald-300" /> {zoneOf(s)}{prCount ? ` — dengan ${prCount} PR` : ""}
            </span>
            <div className="text-primary-foreground/80 text-sm">Predikat: <b>{score.rating}</b> · {e.role}{e.cabang ? ` · ${e.cabang}` : ""}</div>
          </div>
        </div>
        <p className="text-primary-foreground/90 mt-4 max-w-2xl text-sm leading-relaxed">
          {workload.total} item tugas dilaporkan
          {pr?.compliance_rate != null ? ` dengan kepatuhan ${pr.compliance_rate}%` : ""}
          {workload.total > 0 ? `; ${Math.round((workload.success / workload.total) * 100)}% berhasil langsung` : ""}.
          {prCount ? ` ${prCount} area jadi fokus perbaikan.` : " Konsisten & solid."}
        </p>
      </div>
      <Card>
        <CardContent className="p-6">
          <div className="text-muted-foreground text-xs font-medium tracking-wide">INDEKS KEPUASAN KINERJA</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-5xl font-bold tabular-nums ${scoreTone(s)}`}>{s ?? "—"}</span>
            <span className="text-muted-foreground text-lg">/100</span>
            <span className={`ml-auto text-sm font-medium ${scoreTone(s)}`}>→ zona {zoneOf(s)}</span>
          </div>
          <div className="mt-4">
            <div className="relative h-2.5 w-full rounded-full" style={{ background: "linear-gradient(to right, var(--chart-3), var(--chart-4), var(--chart-1))" }}>
              <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-foreground" style={{ left: `calc(${pct}% - 2px)` }} />
            </div>
            <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
              <span>Tidak Puas</span><span>Cukup</span><span>Puas</span>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">Komposit: penyelesaian, kepatuhan lapor, cakupan &amp; item tertunda{e.is_am ? ", revenue & AR" : ""}.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatRow({ pr, workload, absensi }: { pr: RaportDetail["plan_report"]; workload: RaportDetail["workload"]; absensi: RaportDetail["absensi"] }) {
  const tiles = [
    { label: "Tingkat Penyelesaian", value: pr?.completion != null ? `${pr.completion}%` : "—", sub: `${workload.success} / ${workload.total} berhasil`, tone: "text-emerald-600" },
    { label: "Kepatuhan Lapor", value: pr?.compliance_rate != null ? `${pr.compliance_rate}%` : "—", sub: `${pr?.on_time ?? 0} tepat / ${pr?.expected ?? 0} hari`, tone: "text-emerald-600" },
    { label: "Total Item", value: String(workload.total), sub: `${pr?.plan_count ?? 0} plan`, tone: "" },
    { label: "Item Tertunda", value: String(workload.pending), sub: `${pr?.late ?? 0} telat`, tone: "text-amber-600" },
    { label: "Hari Aktif", value: String(absensi.active_days), sub: `${absensi.leave_days} cuti/izin`, tone: "" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Card key={t.label}><CardContent className="p-4">
          <div className="text-muted-foreground text-xs">{t.label}</div>
          <div className={`mt-1 text-3xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
          <div className="text-muted-foreground mt-0.5 text-xs">{t.sub}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Scorecard({ bsc }: { bsc: NonNullable<RaportDetail["bsc"]> }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide">BALANCED SCORECARD</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {PERSPS.map((p) => {
          const objectives = bsc.objectives?.[p.key] ?? [];
          const sc = bsc.persp?.[p.key];
          const badge = sc != null ? perspBadge(sc) : null;
          if (!objectives.length && sc == null) return null;
          return (
            <Card key={p.key} className="border-l-4" style={{ borderLeftColor: p.accent }}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <div className="text-muted-foreground text-xs font-medium tracking-wide">{p.label.toUpperCase()}</div>
                  <CardTitle className="mt-1 text-base">{objectives[0] ?? "—"}</CardTitle>
                </div>
                {badge ? <Badge variant="outline" className={`shrink-0 ${badge.c}`}>{badge.t}{sc != null ? ` · ${Math.round(sc)}` : ""}</Badge> : null}
              </CardHeader>
              {objectives.length > 1 ? (
                <CardContent>
                  <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-sm">
                    {objectives.slice(1).map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function CategoryStatus({ items }: { items: RaportDetail["items"] }) {
  const maxCat = Math.max(1, ...items.categories.map((c) => c.count));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sebaran tugas per kategori</CardTitle>
          <p className="text-muted-foreground text-xs">Jumlah item dalam laporan · total {items.total}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.categories.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <div className="text-muted-foreground w-36 shrink-0 truncate text-sm">{c.label}</div>
              <div className="bg-muted h-4 flex-1 overflow-hidden rounded">
                <div className="h-full rounded" style={{ width: `${(c.count / maxCat) * 100}%`, background: "var(--chart-2)" }} />
              </div>
              <div className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{c.count}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rincian status {items.total} item</CardTitle>
          <p className="text-muted-foreground text-xs">Proporsi hasil pelaporan</p>
        </CardHeader>
        <CardContent>
          <div className="flex h-7 w-full overflow-hidden rounded-md">
            {items.status.map((s) => (
              <div key={s.key} className="flex items-center justify-center text-xs font-semibold text-white" style={{ width: `${(s.count / Math.max(1, items.total)) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`}>
                {s.count / Math.max(1, items.total) > 0.12 ? s.count : ""}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {items.status.map((s) => (
              <span key={s.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-muted-foreground">{s.label}</span></span>
                <span className="font-semibold tabular-nums">{s.count}</span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FailBlock({ items, narrative }: { items: RaportDetail["items"]; narrative: RaportDetail["narrative"] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><span className="size-2.5 rounded-full bg-red-500" /> Kegagalan nyata ({items.failures.length} item)</CardTitle>
          <p className="text-muted-foreground text-xs">Perlu tindak lanjut — item internal belum tuntas</p>
        </CardHeader>
        <CardContent>
          {items.failures.length ? (
            <ul className="divide-y text-sm">
              {items.failures.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-3"><span className="text-muted-foreground w-14 shrink-0 text-xs">{f.tanggal.slice(5)}</span><span>{f.label}</span></span>
                  <Badge variant="outline" className="shrink-0 border-red-200 text-red-600">{f.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground text-sm">Tidak ada kegagalan internal.</p>}
          {narrative?.akar_masalah ? (
            <p className="mt-3 rounded-md border-l-2 border-red-300 bg-red-50 p-2 text-xs dark:bg-red-950/30">
              <b>Akar masalah:</b> {narrative.akar_masalah}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><span className="size-2.5 rounded-full bg-blue-500" /> Blokir eksternal ({items.blockers.length} item)</CardTitle>
          <p className="text-muted-foreground text-xs">Menunggu pihak lain — di luar kendali</p>
        </CardHeader>
        <CardContent>
          {items.blockers.length ? (
            <ul className="divide-y text-sm">
              {items.blockers.map((b, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-3"><span className="text-muted-foreground w-14 shrink-0 text-xs">{b.tanggal.slice(5)}</span><span>{b.label}</span></span>
                  <Badge variant="outline" className="shrink-0 border-blue-200 text-blue-600">{b.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground text-sm">Tidak ada blokir eksternal.</p>}
          {narrative?.catatan_adil ? (
            <p className="mt-3 rounded-md border-l-2 border-blue-300 bg-blue-50 p-2 text-xs dark:bg-blue-950/30">
              <b>Catatan adil:</b> {narrative.catatan_adil}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// Kesimpulan naratif (Fase 3, AI) — mengikuti mockup: verdict + 2 kolom + ringkasan.
function Kesimpulan({ narrative, nama }: { narrative: NonNullable<RaportDetail["narrative"]>; nama: string }) {
  const okVerdict = narrative.verdict === "ya";
  const verdictTone = okVerdict ? "bg-emerald-100 text-emerald-700" : narrative.verdict === "tidak" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  return (
    <Card>
      <CardContent className="p-6">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide">KESIMPULAN</div>
        {narrative.headline ? <h2 className="mt-1 text-xl font-bold">{narrative.headline}</h2> : null}
        {narrative.verdict ? (
          <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${verdictTone}`}>
            {okVerdict ? "✓ " : ""}{narrative.verdict === "ya" ? "Puas" : narrative.verdict === "tidak" ? "Belum puas" : "Bersyarat"}
            {narrative.predikat ? ` — ${narrative.predikat}` : ""}
          </span>
        ) : null}
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold tracking-wide text-emerald-600">YANG MEMBUAT PANTAS PUAS</div>
            {narrative.pantas_puas.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm">{narrative.pantas_puas.map((s, i) => <li key={i}>{s}</li>)}</ul>
            ) : <p className="text-muted-foreground text-sm">—</p>}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold tracking-wide text-amber-600">YANG PERLU DIPERBAIKI</div>
            {narrative.penahan.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm">{narrative.penahan.map((s, i) => <li key={i}>{s}</li>)}</ul>
            ) : <p className="text-muted-foreground text-sm">—</p>}
          </div>
        </div>
        {narrative.ringkasan ? <p className="mt-4 border-t pt-4 text-sm leading-relaxed">{narrative.ringkasan}</p> : null}
        <p className="text-muted-foreground mt-3 text-xs">
          Penilaian {nama} · dihasilkan AI {narrative.generated_at ? `· ${new Date(narrative.generated_at).toLocaleDateString("id-ID")}` : ""}{narrative.model && narrative.model !== "dry-run" ? ` · ${narrative.model}` : ""}. Ditinjau HoD/admin.
        </p>
      </CardContent>
    </Card>
  );
}

function DailyChart({ daily }: { daily: RaportDetail["daily"] }) {
  const cfg = { total: { label: "Total item", color: "var(--chart-2)" }, success: { label: "Berhasil", color: "var(--chart-1)" } } satisfies ChartConfig;
  const rows = daily.map((d) => ({ ...d, label: shortDay(d.date) }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Beban &amp; keberhasilan harian</CardTitle>
        <p className="text-muted-foreground text-xs">Total item vs. item berhasil per laporan</p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={cfg} className="aspect-auto h-[240px] w-full">
          <ComposedChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} />
            <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} fill="var(--color-total)" fillOpacity={0.12} />
            <Scatter dataKey="success" fill="var(--color-success)" />
          </ComposedChart>
        </ChartContainer>
        <div className="mt-2 flex gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "var(--chart-2)" }} /> Total item</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: "var(--chart-1)" }} /> Berhasil</span>
        </div>
      </CardContent>
    </Card>
  );
}

function OkrBlock({ okr, kpi }: { okr: RaportDetail["okr"]; kpi: KpiRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">OKR — Objective &amp; Key Results</CardTitle>
        {okr?.objective ? <p className="text-muted-foreground text-sm"><b>Objective:</b> {okr.objective}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {kpi.map((k) => {
          const a = k.achievement_pct;
          return (
            <div key={k.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[1.4fr_1fr_120px_48px]">
              <div className="text-sm font-medium">{k.name}</div>
              <div className="text-muted-foreground hidden text-sm sm:block">{k.target ?? "—"}</div>
              <div className="bg-muted h-2 overflow-hidden rounded-full">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, a ?? 0)}%`, background: barColor(a) }} />
              </div>
              <div className={`text-right text-sm font-semibold tabular-nums ${scoreTone(a)}`}>{a != null ? `${Math.round(a)}%` : "—"}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
function OkrTextOnly({ okr }: { okr: NonNullable<RaportDetail["okr"]> }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">OKR</CardTitle>
        {okr.objective ? <p className="text-muted-foreground text-sm"><b>Objective:</b> {okr.objective}</p> : null}
      </CardHeader>
      <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{okr.key_results.map((k, i) => <li key={i}>{k}</li>)}</ul></CardContent>
    </Card>
  );
}

function Pdca({ pdca }: { pdca: NonNullable<RaportDetail["pdca"]> }) {
  const cards = [
    { k: "P · PLAN", v: pdca.plan, c: "var(--chart-2)" },
    { k: "D · DO", v: pdca.do, c: "var(--chart-2)" },
    { k: "C · CHECK", v: pdca.check, c: "var(--chart-2)" },
    { k: "A · ACT", v: pdca.act, c: "var(--chart-4)" },
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide">SIKLUS PDCA</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.k}><CardContent className="p-4">
            <div className="text-sm font-semibold" style={{ color: c.c }}>{c.k}</div>
            <p className="mt-1 text-sm">{c.v ?? "—"}</p>
          </CardContent></Card>
        ))}
      </div>
    </section>
  );
}

function RevenueAr({ revenue, ar }: { revenue: NonNullable<RaportDetail["revenue"]>; ar: RaportDetail["ar"] }) {
  const tiles = [
    { label: "Revenue (netto)", value: rp(revenue.total) },
    { label: "Target bulan", value: revenue.target_month != null ? rp(revenue.target_month) : "—" },
    { label: "Pencapaian", value: revenue.pct != null ? `${revenue.pct}%` : "—" },
    { label: "AR outstanding", value: ar ? rp(ar.outstanding) : "—" },
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide">REVENUE &amp; AR</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}><CardContent className="p-4">
            <div className="text-muted-foreground text-xs">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
          </CardContent></Card>
        ))}
      </div>
    </section>
  );
}

const RACI_TONE: Record<string, string> = { R: "bg-blue-100 text-blue-700", A: "bg-red-100 text-red-700", C: "bg-amber-100 text-amber-700", I: "bg-muted text-muted-foreground" };
function Raci({ raci }: { raci: RaportDetail["raci"] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Matriks RACI — Peran per proses</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs"><tr><th className="py-1 pr-3">Proses</th><th className="py-1">Peran</th><th className="py-1 pl-3">Catatan</th></tr></thead>
          <tbody>
            {raci.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1.5 pr-3">{r.process}</td>
                <td className="py-1.5">
                  <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${RACI_TONE[r.role_type?.toUpperCase()?.[0]] ?? "bg-muted"}`}>{r.role_type}</span>
                </td>
                <td className="text-muted-foreground py-1.5 pl-3">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground mt-2 text-xs"><b>R</b> Responsible · <b>A</b> Accountable · <b>C</b> Consulted · <b>I</b> Informed</p>
      </CardContent>
    </Card>
  );
}

function Absensi({ absensi }: { absensi: RaportDetail["absensi"] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Absensi (proxy)</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Hari aktif" value={String(absensi.active_days)} />
          <Mini label="Hari kerja (est.)" value={String(absensi.expected)} />
          <Mini label="Hari cuti/izin" value={String(absensi.leave_days)} />
        </div>
        {absensi.leave.length ? (
          <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
            {absensi.leave.slice(0, 6).map((l, i) => <li key={i}>{l.start_date} → {l.end_date} · <span className="uppercase">{l.jenis}</span>{l.keterangan ? ` · ${l.keterangan}` : ""}</li>)}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
function Coaching({ coaching }: { coaching: NonNullable<RaportDetail["coaching"]> }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Coaching{coaching.score != null ? ` — skor ${coaching.score}` : ""}{coaching.period ? ` (${coaching.period})` : ""}</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <MiniList title="Kekuatan" items={coaching.strengths} />
        <MiniList title="Gap" items={coaching.gaps} />
        <MiniList title="Rekomendasi" items={coaching.recommendations} />
      </CardContent>
    </Card>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground text-xs">{label}</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div></div>;
}
function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-medium">{title}</div>
      {items.length ? <ul className="list-disc space-y-0.5 pl-4 text-sm">{items.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-muted-foreground text-sm">—</p>}
    </div>
  );
}
