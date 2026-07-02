import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DrilldownPlanTable, DrilldownUnmatchedTable } from "@/components/tables/drilldown-tables";

export const dynamic = "force-dynamic";

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
interface Detail {
  user: {
    am_id: string;
    nama: string;
    panggilan: string | null;
    role: string;
    posisi: string | null;
    cabang: string | null;
    wa_number: string | null;
  } | null;
  plan: PlanRow[];
  todo: TodoRow[];
  unmatched: UnmatchedRow[];
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const statusTone = (s?: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "matched" ? "secondary" : s === "unmatched" ? "destructive" : "outline";

async function getDetail(amId: string, from: string, to: string): Promise<Detail | null> {
  try {
    const qs = `am_id=${encodeURIComponent(amId)}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
    const res = await gatewayFetch(`/report/drilldown?${qs}`);
    if (!res.ok) return null;
    return ((await res.json()) as { detail: Detail }).detail;
  } catch {
    return null;
  }
}

export default async function DrilldownPage({
  searchParams,
}: {
  searchParams: Promise<{ am_id?: string; from?: string; to?: string }>;
}) {
  const { am_id, from = "", to = "" } = await searchParams;
  if (!am_id) {
    return (
      <p className="text-muted-foreground">
        Parameter <code>am_id</code> wajib. Kembali ke{" "}
        <Link href="/dashboard" className="text-primary underline">dashboard</Link>.
      </p>
    );
  }
  const d = await getDetail(am_id, from, to);
  const u = d?.user ?? null;
  const isAM = u?.role === "AM";

  return (
    <>
      <div className="flex items-center gap-3">
        <Button render={<Link href="/dashboard" />} nativeButton={false} variant="outline" size="icon-sm">
          <ArrowLeft />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{u?.panggilan ?? am_id}</h1>
            {u && <Badge variant="outline">{u.role}{u.posisi ? ` · ${u.posisi}` : ""}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {u ? `${u.nama}${u.cabang ? ` · ${u.cabang}` : ""}` : am_id} {from && to ? `· ${from} → ${to}` : ""}
          </p>
        </div>
      </div>

      {!d ? (
        <p className="text-muted-foreground">Data tidak tersedia.</p>
      ) : !u ? (
        <p className="text-muted-foreground">AM <code>{am_id}</code> tidak ditemukan.</p>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-4">
              {[
                ["Role", u.role],
                ["Posisi", u.posisi ?? "—"],
                ["Cabang", u.cabang ?? "—"],
                ["WA", u.wa_number ?? "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-muted-foreground text-xs">{k}</div>
                  <div className="font-medium">{v}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {(isAM || d.plan.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Plan Kunjungan ({d.plan.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {d.plan.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Tidak ada plan kunjungan di rentang ini.</p>
                ) : (
                  <DrilldownPlanTable plan={d.plan} />
                )}
              </CardContent>
            </Card>
          )}

          {d.todo.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Todo / Plan Harian ({d.todo.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {d.todo.map((t, i) => {
                  const byIdx = new Map((t.report_data ?? []).map((r) => [r.idx, r]));
                  return (
                    <div key={i} className="rounded-lg border p-3">
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
              </CardContent>
            </Card>
          )}

          {d.unmatched.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Aktivitas di luar plan / unmatched ({d.unmatched.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <DrilldownUnmatchedTable rows={d.unmatched} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
