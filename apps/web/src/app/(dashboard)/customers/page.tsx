import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CustomersRevenueView, type CustomersRevenue } from "@/components/customers/customers-revenue-view";

export const dynamic = "force-dynamic";

async function getData(): Promise<CustomersRevenue | null> {
  try {
    const res = await gatewayFetch(`/customers/revenue`);
    if (!res.ok) return null;
    return (await res.json()) as CustomersRevenue;
  } catch {
    return null;
  }
}

export default async function CustomersPage() {
  const data = await getData();
  return (
    <>
      <PageHeader
        title="Customers"
        description="Revenue ter-faktur per customer (Accurate) — transaksi bulan ini & deteksi dormant >60 hari."
      />
      {!data ? (
        <Card><CardContent className="pt-6"><EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." /></CardContent></Card>
      ) : data.customers.length === 0 ? (
        <Card><CardContent className="pt-6"><EmptyState title="Belum ada faktur" description="Belum ada data accurate_invoice. Jalankan sinkron Accurate." /></CardContent></Card>
      ) : (
        <CustomersRevenueView data={data} />
      )}
    </>
  );
}
