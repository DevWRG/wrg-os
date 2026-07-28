import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddVisitSheet } from "@/components/crm/add-visit-sheet";
import {
  TimelinessCard,
  VisitTargetTable,
  WeeklyTargetCard,
  type TimelinessKpi,
  type VisitTargetKpi,
} from "@/components/crm/visit-target-panel";
import { VisitsTable } from "@/components/tables/visits-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface VisitItem {
  id: string;
  am_id: string;
  nama: string | null;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
  tujuan: string | null;
  goal: string | null;
  catatan: string | null;
  activity_type: string | null;
  account_id: number | null;
  created_at: string;
}
interface VisitResponse {
  count: number;
  visits: VisitItem[];
}
interface VisitSummary {
  total: number;
  by_status: Record<string, number>;
  flagged: number;
}
interface VisitKpi {
  timeliness: TimelinessKpi;
  targets: VisitTargetKpi;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "ok", label: "Valid" },
  { key: "no_geo", label: "Tanpa GPS" },
  { key: "date_mismatch", label: "Tanggal tak cocok" },
  { key: "out_of_bounds", label: "Di luar Indonesia" },
];

// x-user-id → backend menerapkan row-level scope (AM = kunjungan sendiri, HoD =
// cabang tim, admin = semua). Tanpa sesi (auth mati/dev) header tak dikirim →
// backend pakai FULL_SCOPE seperti perilaku lama.
async function getJson<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(`${path}`, userId ? { headers: { "x-user-id": userId } } : undefined);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status && FILTERS.some((f) => f.key === status) ? status : "";
  const qs = active ? `?status=${encodeURIComponent(active)}` : "";

  const me = await sessionUser();
  const [summary, list, kpi] = await Promise.all([
    getJson<VisitSummary>("/visits/summary", me?.id),
    getJson<VisitResponse>(`/visits${qs}`, me?.id),
    getJson<VisitKpi>("/visits/kpi", me?.id),
  ]);
  const visits = list?.visits ?? null;

  const total = summary?.total ?? 0;
  const ok = summary?.by_status?.ok ?? 0;
  const noGeo = summary?.by_status?.no_geo ?? 0;
  const review = (summary?.by_status?.date_mismatch ?? 0) + (summary?.by_status?.out_of_bounds ?? 0);

  return (
    <>
      <PageHeader
        title="Visits"
        description="Kunjungan AM dengan geotag + foto (port visit). Geo divalidasi terhadap bbox Indonesia."
        action={<AddVisitSheet />}
      />

      {!summary ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : total === 0 ? (
        <p className="text-muted-foreground">
          Belum ada kunjungan. Catat via <code>POST /visits</code>.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Total kunjungan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Geo valid</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{ok}</div>
                <p className="text-muted-foreground text-xs">{total > 0 ? Math.round((ok / total) * 100) : 0}% dari total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Tanpa GPS</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{noGeo}</div>
                <p className="text-muted-foreground text-xs">tak ada koordinat</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Perlu ditinjau</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{review}</div>
                <p className="text-muted-foreground text-xs">tanggal tak cocok / luar bbox</p>
              </CardContent>
            </Card>
            {kpi ? <TimelinessCard kpi={kpi.timeliness} /> : null}
            {kpi ? <WeeklyTargetCard kpi={kpi.targets} /> : null}
          </div>

          {kpi ? <VisitTargetTable kpi={kpi.targets} /> : null}

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const count = f.key === "" ? total : (summary.by_status?.[f.key] ?? 0);
              return (
                <Link
                  key={f.key || "all"}
                  href={f.key ? `/visits?status=${f.key}` : "/visits"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition-colors",
                    active === f.key
                      ? "border-primary bg-primary-soft text-primary font-medium"
                      : "border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-primary/40 hover:bg-muted",
                  )}
                >
                  {f.label}
                  <span className={cn("text-xs tabular-nums", active === f.key ? "opacity-80" : "text-muted-foreground")}>{count}</span>
                </Link>
              );
            })}
          </div>

          <Card>
            <CardContent className="pt-6">
              {!visits ? (
                <p className="text-muted-foreground">Gagal memuat daftar kunjungan.</p>
              ) : visits.length === 0 ? (
                <p className="text-muted-foreground">Tidak ada kunjungan untuk filter ini.</p>
              ) : (
                <VisitsTable visits={visits} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
