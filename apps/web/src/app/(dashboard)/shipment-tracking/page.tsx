import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddShipmentTrackingSheet } from "@/components/crm/add-shipment-tracking-sheet";
import { ShipmentTrackingTable, type ShipmentTracking } from "@/components/tables/shipment-tracking-table";

export const dynamic = "force-dynamic";

async function getShipments(): Promise<ShipmentTracking[] | null> {
  try {
    const res = await gatewayFetch("/shipment-tracking");
    if (!res.ok) return null;
    const data = (await res.json()) as { shipments: ShipmentTracking[] };
    return data.shipments ?? [];
  } catch {
    return null;
  }
}

export default async function ShipmentTrackingPage() {
  const shipments = await getShipments();
  return (
    <>
      <PageHeader
        title="Tracking Pengiriman"
        description="Status kirim per SJ (draft → dikirim → BAST) + ETA dari jarak cabang→customer. Dipicu manual atau WA hashtag #KIRIM/#BAST dari kurir."
        action={<AddShipmentTrackingSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!shipments ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : shipments.length === 0 ? (
            <EmptyState title="Belum ada tracking pengiriman" description="Tambah lewat tombol di atas." />
          ) : (
            <ShipmentTrackingTable shipments={shipments} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
