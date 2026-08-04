import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { ItAssetView } from "@/components/crm/it-asset-view";
import type { ItTicket } from "@/components/tables/it-tickets-table";
import type { GaAsset } from "@/components/tables/ga-assets-table";

export const dynamic = "force-dynamic";

async function getTickets(): Promise<ItTicket[] | null> {
  try {
    const res = await gatewayFetch("/it-tickets");
    if (!res.ok) return null;
    const data = (await res.json()) as { tickets: ItTicket[] };
    return data.tickets ?? [];
  } catch {
    return null;
  }
}

// Master aset (termasuk aset IT) sekarang dikelola di F132 (/ga-aset) — page
// ini cuma pinjam daftarnya utk picker "Buat Tiket".
async function getAssets(): Promise<GaAsset[]> {
  try {
    const res = await gatewayFetch("/ga-assets?all=true");
    if (!res.ok) return [];
    const data = (await res.json()) as { assets: GaAsset[] };
    return data.assets ?? [];
  } catch {
    return [];
  }
}

export default async function ItAssetPage() {
  const [tickets, assets] = await Promise.all([getTickets(), getAssets()]);
  return (
    <>
      <PageHeader
        title="Tiket IT"
        description="Tiket masalah per aset (SLA 2 jam utk aset kritis, 24 jam normal, dihitung hari kerja). Master aset kelola di menu Aset GA."
      />
      <ItAssetView tickets={tickets} assets={assets} />
    </>
  );
}
