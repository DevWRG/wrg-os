"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodPicker, defaultPeriod } from "@/components/raport/period-picker";

// ── Tipe (selaras apps/api getRaportDetail) ──
interface ScorePart { key: string; label: string; score: number | null; weight: number; eff_weight: number }
interface KpiRow { id: string; name: string; target: string | null; perspective: string | null; achievement_pct: number | null }
export interface RaportDetail {
  linked?: boolean;
  message?: string;
  found?: boolean;
  period: string;
  employee: { am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; is_am: boolean; spine_id: string | null };
  score: { overall: number | null; rating: string; parts: ScorePart[] };
  plan_report: { plan_count: number; report_count: number; completion: number | null; active_days: number; late: number; unmatched: number; expected: number; on_time: number; late_days: number; miss: number; compliance_rate: number | null } | null;
  bsc: { score: number | null; persp: Record<string, number>; kpi: KpiRow[] } | null;
  okr: { objective: string | null; key_results: string[] } | null;
  raci: { process: string; role_type: string; note: string | null }[];
  absensi: { active_days: number; expected: number; leave_days: number; leave: { start_date: string; end_date: string; jenis: string; keterangan: string | null }[] };
  coaching: { period: string | null; score: number | null; strengths: string[]; gaps: string[]; recommendations: string[] } | null;
  revenue: { total: number; invoices: number; target_year: number | null; target_month: number | null; pct: number | null } | null;
  ar: { outstanding: number; invoices: number } | null;
  context_note: string;
}

const PERSP_LABEL: Record<string, string> = { fin: "Finansial", cust: "Pelanggan", proc: "Proses", learn: "Pembelajaran" };
const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const scoreTone = (s: number | null) =>
  s == null ? "text-muted-foreground" : s >= 95 ? "text-emerald-600" : s >= 80 ? "text-amber-600" : "text-red-600";
const barTone = (s: number | null) =>
  s == null ? "bg-muted" : s >= 95 ? "bg-emerald-500" : s >= 80 ? "bg-amber-500" : "bg-red-500";

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
      .then((d: RaportDetail) => {
        if (!alive) return;
        setData(d);
        setState("idle");
      })
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
        <Card><CardContent className="text-muted-foreground py-8 text-center text-sm">
          {data.message ?? "Akun belum tertaut ke data karyawan."}
        </CardContent></Card>
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
  const { employee: e, score, plan_report: pr, bsc, okr, raci, absensi, coaching, revenue, ar } = data;

  return (
    <div className="space-y-5">
      {/* Header + skor komposit */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-lg">{e.panggilan || e.nama}</CardTitle>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>{e.nama}</span>
              <Badge variant="outline">{e.role}</Badge>
              {e.cabang ? <span>· {e.cabang}</span> : null}
              {!e.spine_id ? <Badge variant="secondary">belum tertaut spine</Badge> : null}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold tabular-nums ${scoreTone(score.overall)}`}>
              {score.overall ?? "—"}
            </div>
            <div className={`text-sm font-medium ${scoreTone(score.overall)}`}>{score.rating}</div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {score.parts.map((p) => (
              <div key={p.key} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm">{p.label}</div>
                <div className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full">
                  <div className={`h-full rounded-full ${barTone(p.score)}`} style={{ width: `${Math.min(100, p.score ?? 0)}%` }} />
                </div>
                <div className={`w-10 shrink-0 text-right text-sm font-medium tabular-nums ${scoreTone(p.score)}`}>
                  {p.score ?? "—"}
                </div>
                <div className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                  {p.score == null ? "—" : `bobot ${p.eff_weight}%`}
                </div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">{data.context_note}</p>
        </CardContent>
      </Card>

      {/* Plan & Report */}
      {pr ? (
        <Section title="Plan & Report">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={e.is_am ? "Visit direncanakan" : "Task direncanakan"} value={String(pr.plan_count)} />
            <Stat label="Dilaporkan" value={String(pr.report_count)} />
            <Stat label="Completion" value={pr.completion != null ? `${pr.completion}%` : "—"} />
            <Stat label="Hari aktif" value={String(pr.active_days)} />
            <Stat label="Compliance rate" value={pr.compliance_rate != null ? `${pr.compliance_rate}%` : "—"} />
            <Stat label="Tepat waktu" value={String(pr.on_time)} />
            <Stat label="Telat" value={String(pr.late_days)} />
            <Stat label="Miss (tanpa plan)" value={String(pr.miss)} />
          </div>
        </Section>
      ) : null}

      {/* Revenue & AR (AM) */}
      {e.is_am && revenue ? (
        <Section title="Revenue & AR">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Revenue (netto)" value={rp(revenue.total)} />
            <Stat label="Target bulan" value={revenue.target_month != null ? rp(revenue.target_month) : "—"} />
            <Stat label="Pencapaian" value={revenue.pct != null ? `${revenue.pct}%` : "—"} />
            <Stat label="Invoice" value={String(revenue.invoices)} />
            <Stat label="AR outstanding" value={ar ? rp(ar.outstanding) : "—"} />
            <Stat label="AR invoice terbuka" value={ar ? String(ar.invoices) : "—"} />
          </div>
        </Section>
      ) : null}

      {/* BSC / KPI */}
      {bsc && bsc.kpi.length ? (
        <Section title={`BSC / KPI${bsc.score != null ? ` — skor ${bsc.score}` : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr><th className="py-1 pr-3">KPI</th><th className="py-1 pr-3">Perspektif</th><th className="py-1 pr-3">Target</th><th className="py-1 text-right">Achievement</th></tr>
              </thead>
              <tbody>
                {bsc.kpi.map((k) => (
                  <tr key={k.id} className="border-t">
                    <td className="py-1.5 pr-3">{k.name}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{k.perspective ? PERSP_LABEL[k.perspective] ?? k.perspective : "—"}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{k.target ?? "—"}</td>
                    <td className={`py-1.5 text-right tabular-nums ${scoreTone(k.achievement_pct)}`}>{k.achievement_pct != null ? `${k.achievement_pct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {/* OKR */}
      {okr && (okr.objective || okr.key_results.length) ? (
        <Section title="OKR">
          {okr.objective ? <p className="mb-2 text-sm font-medium">{okr.objective}</p> : null}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {okr.key_results.map((kr, i) => <li key={i}>{kr}</li>)}
          </ul>
        </Section>
      ) : null}

      {/* RACI */}
      {raci.length ? (
        <Section title="RACI">
          <div className="flex flex-wrap gap-2">
            {raci.map((r, i) => (
              <Badge key={i} variant="outline" className="font-normal">
                <span className="font-semibold">{r.role_type}</span>&nbsp;· {r.process}
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Absensi (proxy) */}
      <Section title="Absensi (proxy)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Hari aktif" value={String(absensi.active_days)} />
          <Stat label="Hari kerja (est.)" value={String(absensi.expected)} />
          <Stat label="Hari cuti/izin" value={String(absensi.leave_days)} />
        </div>
        {absensi.leave.length ? (
          <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
            {absensi.leave.slice(0, 6).map((l, i) => (
              <li key={i}>{l.start_date} → {l.end_date} · <span className="uppercase">{l.jenis}</span>{l.keterangan ? ` · ${l.keterangan}` : ""}</li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* Coaching */}
      {coaching ? (
        <Section title={`Coaching${coaching.score != null ? ` — skor ${coaching.score}` : ""}${coaching.period ? ` (${coaching.period})` : ""}`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniList title="Kekuatan" items={coaching.strengths} />
            <MiniList title="Gap" items={coaching.gaps} />
            <MiniList title="Rekomendasi" items={coaching.recommendations} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-medium">{title}</div>
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-sm">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
      ) : (
        <p className="text-muted-foreground text-sm">—</p>
      )}
    </div>
  );
}
