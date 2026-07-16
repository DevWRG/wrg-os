import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { type ArGroup } from "@/components/tables/ar-breakdown-tabs";
import { ArAgingTabs } from "@/components/tables/ar-aging-tabs";
import { type ArCustomer } from "@/components/tables/ar-by-customer-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Invoice {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  due_date: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  is_anomaly: boolean;
}
interface Aging {
  total_outstanding: number;
  total_invoices: number;
  buckets: { bucket: string; count: number; total: number }[];
  invoices: Invoice[];
}

const BUCKET_ORDER = ["current", "1-30", "31-60", "61-90", "90+"];

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

interface AreaAr {
  area: string;
  customers: number;
  invoices: number;
  outstanding: number;
}
interface SalesAr {
  total_outstanding: number;
  total_invoices: number;
  by_customer: ArGroup[];
  by_cabang: ArGroup[];
  by_sales: ArGroup[];
  areas: { east: AreaAr; west: AreaAr; office: AreaAr; unmapped: AreaAr };
}

async function getAging(): Promise<Aging | null> {
  try {
    const res = await gatewayFetch(`/ar/aging`);
    if (!res.ok) return null;
    return (await res.json()) as Aging;
  } catch {
    return null;
  }
}

async function getSalesAr(): Promise<SalesAr | null> {
  try {
    const res = await gatewayFetch(`/ar/sales`);
    if (!res.ok) return null;
    return (await res.json()) as SalesAr;
  } catch {
    return null;
  }
}

interface ByCustomer {
  summary: { total_customers: number; total_outstanding: number; overdue_outstanding: number; kritis: number };
  customers: ArCustomer[];
}
async function getByCustomer(): Promise<ByCustomer | null> {
  try {
    const res = await gatewayFetch(`/ar/aging/by-customer`);
    if (!res.ok) return null;
    return (await res.json()) as ByCustomer;
  } catch {
    return null;
  }
}

export default async function ArAgingPage() {
  const [data, ar, byCust] = await Promise.all([getAging(), getSalesAr(), getByCustomer()]);

  return (
    <>
      <PageHeader
        title="AR Aging"
        description="Piutang (outstanding invoice OPEN) per customer / cabang / sales + aging per bucket umur. Data live dari Accurate."
      />

      {data && data.total_invoices > 0 && (
        <>
          <h2 className="text-muted-foreground pt-2 text-[11px] font-semibold tracking-wider uppercase">Aging per bucket umur</h2>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Total Outstanding
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{rupiah(data.total_outstanding)}</div>
                <p className="text-muted-foreground text-xs">{data.total_invoices} invoice</p>
              </CardContent>
            </Card>
            {BUCKET_ORDER.map((b) => {
              const row = data.buckets.find((x) => x.bucket === b);
              return (
                <Card key={b}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-muted-foreground text-sm font-medium">
                      {b}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-semibold">{rupiah(row?.total ?? 0)}</div>
                    <p className="text-muted-foreground text-xs">{row?.count ?? 0} invoice</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {ar && ar.total_invoices > 0 && (
        <>
          <h2 className="text-muted-foreground pt-2 text-[11px] font-semibold tracking-wider uppercase">Per area</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-primary/30 bg-primary-soft">
              <CardHeader className="pb-2">
                <CardTitle className="text-primary text-sm font-medium">East Area</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{rupiah(ar.areas.east.outstanding)}</div>
                <p className="text-muted-foreground text-xs">{ar.areas.east.customers} customer · {ar.areas.east.invoices} open inv</p>
              </CardContent>
            </Card>
            <Card className="border-warning/30 bg-warning-soft">
              <CardHeader className="pb-2">
                <CardTitle className="text-warning text-sm font-medium">West Area</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{rupiah(ar.areas.west.outstanding)}</div>
                <p className="text-muted-foreground text-xs">{ar.areas.west.customers} customer · {ar.areas.west.invoices} open inv</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Office</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{rupiah(ar.areas.office.outstanding)}</div>
                <p className="text-muted-foreground text-xs">{ar.areas.office.customers} customer · {ar.areas.office.invoices} open inv</p>
              </CardContent>
            </Card>
          </div>
          {ar.areas.unmapped.invoices > 0 && (
            <p className="text-muted-foreground text-xs">
              {ar.areas.unmapped.invoices} invoice ({rupiah(ar.areas.unmapped.outstanding)}) belum terpetakan ke area —
              salesman tanpa cabang/master_user di data Accurate.
            </p>
          )}
        </>
      )}

      {data && data.total_invoices > 0 && (
        <>
          <h2 className="text-muted-foreground pt-2 text-[11px] font-semibold tracking-wider uppercase">Rincian piutang (klik baris untuk detail invoice)</h2>
          <Card>
            <CardContent className="pt-6">
              <ArAgingTabs customers={byCust?.customers ?? []} invoices={data.invoices} byCabang={ar?.by_cabang ?? []} bySales={ar?.by_sales ?? []} />
            </CardContent>
          </Card>
        </>
      )}

      {(!ar || ar.total_invoices === 0) && (!data || data.total_invoices === 0) && (
        <p className="text-muted-foreground">
          Belum ada data piutang. Pastikan <code>apps/api</code> jalan &amp; data Accurate ter-sync.
        </p>
      )}
    </>
  );
}
