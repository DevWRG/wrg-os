import { TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Kartu Sales Performance (target vs realisasi per periode + breakdown region).
// Data periodik (YTD/kuartal/bulan) dari GET /sales/performance — lihat
// apps/api/src/repo/sales.ts:reportSalesPerformance. Target/region diisi via
// config di apps/api/src/config/*. Target null → tampil "No data".

type Region = "OFFICE" | "West" | "East";
interface RegionTotal {
  region: Region;
  total: number;
}
interface Period {
  key: "year" | "quarter" | "month";
  label: string;
  from: string;
  to: string;
  total: number;
  regions: RegionTotal[];
  target: { east: number | null; west: number | null; total: number | null };
  pct: { total: number | null; east: number | null; west: number | null };
}
export interface SalesPerformance {
  as_of: string;
  periods: Period[];
  mtd_vs_last: {
    current: { from: string; to: string; total: number };
    previous: { from: string; to: string; total: number };
    growth_pct: number | null;
  };
}

const rpC = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const rpFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// Nada progress terhadap target (null = belum ada target).
function tone(pct: number | null): { bar: string; text: string } {
  if (pct == null) return { bar: "bg-muted-foreground/30", text: "text-muted-foreground" };
  if (pct >= 100) return { bar: "bg-success", text: "text-success" };
  if (pct >= 60) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-danger", text: "text-danger" };
}

const SHORT: Record<Period["key"], string> = { year: "YTD", quarter: "Quarter", month: "Month" };

function RegionBars({ rows }: { rows: RegionTotal[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.region}>
          <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{r.region}</span>
            <span className="tabular-nums">{rpC(r.total)}</span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: `${(r.total / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PeriodCard({ p }: { p: Period }) {
  const t = tone(p.pct.total);
  const barW = p.pct.total == null ? 0 : Math.min(100, Math.max(0, p.pct.total));
  const fmtPct = (v: number | null) => (v == null ? "No data" : `${v}%`);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base font-semibold">{p.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-muted-foreground text-xs">Total Revenue</p>
          <div className="text-2xl font-semibold tabular-nums">{rpC(p.total)}</div>
          <p className={cn("text-xs", t.text)}>
            {p.pct.total == null ? "No data" : `${p.pct.total}%`} of target{" "}
            {p.target.total == null ? "No data" : rpFull(p.target.total)}
          </p>
          <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
            <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${barW}%` }} />
          </div>
        </div>

        <RegionBars rows={p.regions} />

        <div className="grid grid-cols-2 gap-2 border-t pt-2 text-center">
          <div>
            <div className="text-muted-foreground text-[11px]">% {SHORT[p.key]} East Target</div>
            <div className={cn("text-lg font-semibold", tone(p.pct.east).text)}>{fmtPct(p.pct.east)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[11px]">% {SHORT[p.key]} West Target</div>
            <div className={cn("text-lg font-semibold", tone(p.pct.west).text)}>{fmtPct(p.pct.west)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MtdVsLastCard({ d }: { d: SalesPerformance["mtd_vs_last"] }) {
  const g = d.growth_pct;
  const up = g != null && g >= 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base font-semibold">MTD vs Last Month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-muted-foreground text-xs">Bulan ini (s/d hari ini)</p>
          <div className="text-2xl font-semibold tabular-nums">{rpC(d.current.total)}</div>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Bulan lalu (periode sama)</p>
          <div className="text-lg font-medium tabular-nums">{rpC(d.previous.total)}</div>
        </div>
        <div className="border-t pt-2">
          {g == null ? (
            <span className="text-muted-foreground text-sm">No data</span>
          ) : (
            <span className={cn("flex items-center gap-1 text-lg font-semibold", up ? "text-success" : "text-danger")}>
              {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              {up ? "+" : ""}
              {g}%
            </span>
          )}
          <p className="text-muted-foreground text-xs">vs bulan lalu</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SalesPerformanceCards({ data }: { data: SalesPerformance }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {data.periods.map((p) => (
        <PeriodCard key={p.key} p={p} />
      ))}
      <MtdVsLastCard d={data.mtd_vs_last} />
    </div>
  );
}
