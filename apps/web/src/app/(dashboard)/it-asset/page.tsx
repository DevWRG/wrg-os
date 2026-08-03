import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { ItAssetView } from "@/components/crm/it-asset-view";
import type { ItTicket } from "@/components/tables/it-tickets-table";
import type { ItAsset } from "@/components/tables/it-assets-table";

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

async function getAssets(): Promise<ItAsset[]> {
  try {
    const res = await gatewayFetch("/it-assets?all=true");
    if (!res.ok) return [];
    const data = (await res.json()) as { assets: ItAsset[] };
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
        title="IT Asset & Issue Tracker"
        description="Tiket masalah per aset IT (SLA 2 jam utk aset kritis, 24 jam normal, dihitung hari kerja) + master aset PC/laptop."
      />
      <ItAssetView tickets={tickets} assets={assets} />
    </>
  );
}
