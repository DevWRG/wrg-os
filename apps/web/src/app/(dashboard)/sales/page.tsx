import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { SalesTable } from "@/components/tables/sales-table";
import { SalesDateRange } from "@/components/sales/sales-date-range";
import { RevenueExportButton } from "@/components/sales/revenue-export-button";
import { SalesPerformanceCards, type SalesPerformance } from "@/components/sales/sales-performance-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface RankRow {
  key: string;
  label: string;
  sub?: string;
  total: number;
  count: number;
  target?: number;
}
interface Revenue {
  from: string;
  to: string;
  total: number;
  invoices: number;
  customers: number;
  per_customer: RankRow[];
  per_salesman: RankRow[];
  per_cabang: RankRow[];
  per_product: RankRow[];
  per_category: RankRow[];
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const rupiahFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type Tab = "customer" | "salesman" | "cabang" | "product" | "category";
const TABS: { key: Tab; label: string; field: keyof Pick<Revenue, "per_customer" | "per_salesman" | "per_cabang" | "per_product" | "per_category"> }[] = [
  { key: "customer", label: "Per Customer", field: "per_customer" },
  { key: "salesman", label: "Per Sales", field: "per_salesman" },
  { key: "cabang", label: "Per Cabang", field: "per_cabang" },
  { key: "product", label: "Per Produk", field: "per_product" },
  { key: "category", label: "Per Kategori", field: "per_category" },
];

async function getRevenue(from: string, to: string): Promise<Revenue | null> {
  try {
    const res = await gatewayFetch(`/sales/revenue?from=${from}&to=${to}`);
    if (!res.ok) return null;
    return (await res.json()) as Revenue;
  } catch {
    return null;
  }
}

// Kartu periodik (YTD/kuartal/bulan) — independen dari filter Dari/Sampai.
async function getPerformance(): Promise<SalesPerformance | null> {
  try {
    const res = await gatewayFetch(`/sales/performance`);
    if (!res.ok) return null;
    return (await res.json()) as SalesPerformance;
  } catch {
    return null;
  }
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "customer") as Tab;
  const [data, perf] = await Promise.all([getRevenue(sp.from ?? "", sp.to ?? ""), getPerformance()]);
  const rangeQs = sp.from && sp.to ? `&from=${sp.from}&to=${sp.to}` : "";
  const rows = data ? data[TABS.find((t) => t.key === tab)!.field] : [];

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Sales Performance"
          description={data ? `Revenue Accurate · ${data.from} → ${data.to}` : "Revenue dari faktur Accurate (accurate_invoice)."}
        />
        <SalesDateRange tab={tab} from={data?.from ?? sp.from ?? ""} to={data?.to ?? sp.to ?? ""} />
      </div>

      {perf && <SalesPerformanceCards data={perf} />}

      {!data ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : data.invoices === 0 ? (
        <p className="text-muted-foreground">Tidak ada faktur di rentang ini.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-muted-foreground text-sm font-medium">Total Revenue</CardTitle></CardHeader>
              <CardContent><div className="text-success text-2xl font-semibold">{rupiah(data.total)}</div><p className="text-muted-foreground text-xs">{rupiahFull(data.total)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-muted-foreground text-sm font-medium">Faktur</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{data.invoices}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-muted-foreground text-sm font-medium">Customer</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{data.customers}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {TABS.map((t) => (
                    <Link
                      key={t.key}
                      href={`/sales?tab=${t.key}${rangeQs}`}
                      className={cn(
                        "rounded-lg border px-3 py-1 text-sm transition-colors",
                        tab === t.key ? "border-primary bg-primary-soft text-primary font-medium" : "border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-primary/40 hover:bg-muted",
                      )}
                    >
                      {t.label}
                    </Link>
                  ))}
                </div>
                <RevenueExportButton data={data} />
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <SalesTable rows={rows} header={TABS.find((t) => t.key === tab)!.label.replace("Per ", "")} grandTotal={data.total} showTarget={tab === "salesman" || tab === "cabang"} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
