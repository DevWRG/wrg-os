import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OrdersTable, type SalesOrder } from "@/components/tables/orders-table";

export const dynamic = "force-dynamic";

async function getOrders(): Promise<SalesOrder[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/sales-orders?limit=500`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: SalesOrder[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function OrdersPage() {
  const orders = await getOrders();
  return (
    <>
      <PageHeader title="Orders" description="Sales order terbaru dari Accurate (accurate_sales_order)." />
      <Card>
        <CardContent className="pt-6">
          {!orders ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : orders.length === 0 ? (
            <EmptyState title="Belum ada order" description="Jalankan sinkron: POST /accurate/sync/orders." />
          ) : (
            <OrdersTable orders={orders} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
