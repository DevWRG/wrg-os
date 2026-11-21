import { gatewayFetch } from "@/lib/gateway";
import { isoWib } from "@/lib/tanggal-wib";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ShipmentTrackingTable, type ShipmentTracking } from "@/components/tables/shipment-tracking-table";
import { CourierPerformanceClient, type KurirPerformaSummary } from "@/components/shipping/courier-performance-client";

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

function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoWib(from), to: isoWib(to) };
}

async function getSummary(from: string, to: string): Promise<KurirPerformaSummary | null> {
  try {
    const res = await gatewayFetch(`/courier-performance/summary?from=${from}&to=${to}`);
    if (!res.ok) return null;
    return (await res.json()) as KurirPerformaSummary;
  } catch {
    return null;
  }
}

// Tracking Pengiriman + Kinerja Kurir (K4, evaluasi menu 19 Nov 2026): Kurir
// Performance (F43) hanya mengagregasi data tracking ini, jadi dilebur jadi tab.
// Izin tetap dua key: tab Tracking = `shipment-tracking` (induk), tab Kinerja Kurir
// = `courier-performance` (entri features, /courier-performance → ?tab=kurir).
// Hanya tab aktif yang mengambil data.
export default async function ShipmentTrackingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/shipment-tracking");
  const fKurir = induk?.features?.find((f) => f.key === "courier-performance");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "tracking", label: "Status per SJ" });
  if (fKurir && tabVisible(me, fKurir)) tabs.push({ key: "kurir", label: "Kinerja Kurir" });
  const aktif = pilihTab(tabs, tab) ?? "tracking";

  let isi: React.ReactNode;
  if (aktif === "kurir") {
    const { from, to } = last30Days();
    isi = <CourierPerformanceClient initialSummary={await getSummary(from, to)} />;
  } else {
    const shipments = await getShipments();
    isi = (
      <Card>
        <CardContent className="pt-6">
          {!shipments ? (
            <EmptyState title="Data tidak tersedia" description="Data tracking gagal dimuat. Coba muat ulang halaman." />
          ) : shipments.length === 0 ? (
            <EmptyState title="Belum ada tracking pengiriman" description="Pengiriman muncul di sini begitu kurir mengirim #KIRIM <jenis> <nomor> di WA." />
          ) : (
            <ShipmentTrackingTable shipments={shipments} />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Tracking Pengiriman"
        description="Status kirim per SJ dari WA kurir (#KIRIM → #TERIMA → #BAST → #BUKTI) dan durasi rata-rata per kurir. SJ diambil otomatis dari DO Accurate — tak ada input dari web."
      />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "tracking", label: "Status per SJ" }]} aktif={aktif} />
      {isi}
    </>
  );
}
