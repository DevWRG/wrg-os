import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { type CustomersRevenue } from "@/components/customers/customers-revenue-view";
import { type ChurnData } from "@/components/customers/churn-view";
import { type DormantCustomer } from "@/components/sales/win-back-view";
import { CustomersTabs } from "@/components/customers/customers-tabs";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export default async function CustomersPage() {
  const [rev, churn, dorm] = await Promise.all([
    get<CustomersRevenue>("/customers/revenue"),
    get<ChurnData>("/customers/churn?days=60"),
    get<{ customers: DormantCustomer[] }>("/customers/dormant?days=30"),
  ]);
  return (
    <>
      <PageHeader
        title="Customers"
        description="Revenue per pelanggan (monitor + tren), deteksi dini Churn, & Win-back pelanggan tidak aktif. Sumber Accurate."
      />
      {!rev ? (
        <Card><CardContent className="pt-6"><EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." /></CardContent></Card>
      ) : rev.customers.length === 0 ? (
        <Card><CardContent className="pt-6"><EmptyState title="Belum ada faktur" description="Belum ada data accurate_invoice. Jalankan sinkron Accurate." /></CardContent></Card>
      ) : (
        <CustomersTabs revenue={rev} churn={churn} dormant={dorm?.customers ?? []} />
      )}
    </>
  );
}
