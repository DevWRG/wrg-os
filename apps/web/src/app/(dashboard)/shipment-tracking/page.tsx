import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
        description="Status kirim per SJ dari WA kurir: #KIRIM → #TERIMA → #BAST → #BUKTI (mis. #KIRIM SJK 6142). SJ diambil otomatis dari DO Accurate — tak ada input dari web."
      />
      <Card>
        <CardContent className="pt-6">
          {!shipments ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : shipments.length === 0 ? (
            <EmptyState title="Belum ada tracking pengiriman" description="Pengiriman muncul di sini begitu kurir mengirim #KIRIM <jenis> <nomor> di WA." />
          ) : (
            <ShipmentTrackingTable shipments={shipments} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
