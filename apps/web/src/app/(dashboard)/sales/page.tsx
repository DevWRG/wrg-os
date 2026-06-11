import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { SalesTable } from "@/components/tables/sales-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface RankRow {
  key: string;
  label: string;
  total: number;
  count: number;
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
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const rupiahFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type Tab = "customer" | "salesman" | "cabang" | "product";
const TABS: { key: Tab; label: string; field: keyof Pick<Revenue, "per_customer" | "per_salesman" | "per_cabang" | "per_product"> }[] = [
  { key: "customer", label: "Per Customer", field: "per_customer" },
  { key: "salesman", label: "Per Sales", field: "per_salesman" },
  { key: "cabang", label: "Per Cabang", field: "per_cabang" },
  { key: "product", label: "Per Produk", field: "per_product" },
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

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "customer") as Tab;
  const data = await getRevenue(sp.from ?? "", sp.to ?? "");
  const rangeQs = sp.from && sp.to ? `&from=${sp.from}&to=${sp.to}` : "";
  const rows = data ? data[TABS.find((t) => t.key === tab)!.field] : [];

  return (
    <>
      <PageHeader
        title="Sales Performance"
        description={data ? `Revenue Accurate · ${data.from} → ${data.to}` : "Revenue dari faktur Accurate (accurate_invoice)."}
      />

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
              <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                  <Link
                    key={t.key}
                    href={`/sales?tab=${t.key}${rangeQs}`}
                    className={cn(
                      "rounded-lg border px-3 py-1 text-sm transition-colors",
                      tab === t.key ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-muted",
                    )}
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <SalesTable rows={rows} header={TABS.find((t) => t.key === tab)!.label.replace("Per ", "")} grandTotal={data.total} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
