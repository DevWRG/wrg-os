import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ShipmentsTable, type DeliveryOrder } from "@/components/tables/shipments-table";

export const dynamic = "force-dynamic";

async function getShipments(): Promise<DeliveryOrder[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/shipments?limit=500`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: DeliveryOrder[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function ShipmentsPage() {
  const shipments = await getShipments();
  return (
    <>
      <PageHeader title="Shipments" description="Surat jalan / pengiriman terbaru dari Accurate (accurate_delivery_order)." />
      <Card>
        <CardContent className="pt-6">
          {!shipments ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : shipments.length === 0 ? (
            <EmptyState title="Belum ada pengiriman" description="Jalankan sinkron: POST /accurate/sync/shipments." />
          ) : (
            <ShipmentsTable shipments={shipments} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
