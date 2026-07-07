import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { SalesAnalyticsDashboard, type OverviewResult } from "@/components/sales-analytics/sales-analytics-dashboard";

export const dynamic = "force-dynamic";

// F127 Sales Analytics — halaman multi-dimensi. Ambil Executive Overview awal
// (server) lalu client component memuat view lain on-demand via BFF.
export default async function SalesAnalyticsPage() {
  const me = await sessionUser();
  let initial: OverviewResult | null = null;
  try {
    const res = await gatewayFetch("/sales-analytics/overview", {
      headers: me?.id ? { "x-user-id": me.id } : {},
    });
    if (res.ok) initial = (await res.json()) as OverviewResult;
  } catch {
    initial = null;
  }
  return (
    <>
      <PageHeader
        title="Sales Analytics"
        description="Analitik penjualan multi-dimensi: overview, per-AM, per-produk, per-cabang, per-customer, tren. (F127)"
      />
      <SalesAnalyticsDashboard initial={initial} />
    </>
  );
}
