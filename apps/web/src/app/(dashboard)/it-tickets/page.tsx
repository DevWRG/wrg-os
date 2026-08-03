import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItTicketsTable, type ItTicket } from "@/components/tables/it-tickets-table";
import { AddItTicketButton } from "@/components/crm/add-it-ticket-button";

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

interface AssetOption {
  id: string;
  asset_code: string;
  nama: string;
  is_critical: boolean;
}

async function getAssetOptions(): Promise<AssetOption[]> {
  try {
    const res = await gatewayFetch("/it-assets");
    if (!res.ok) return [];
    const data = (await res.json()) as { assets: AssetOption[] };
    return data.assets ?? [];
  } catch {
    return [];
  }
}

export default async function ItTicketsPage() {
  const [tickets, assets] = await Promise.all([getTickets(), getAssetOptions()]);
  return (
    <>
      <PageHeader
        title="Tiket IT"
        description="Laporkan & pantau masalah per aset IT — SLA otomatis 2 jam untuk aset kritis (mis. PC Fakturis), 24 jam untuk aset normal, dihitung hari kerja."
        action={<AddItTicketButton assets={assets} />}
      />
      <Card>
        <CardContent className="pt-6">
          {!tickets ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : tickets.length === 0 ? (
            <EmptyState
              title="Belum ada tiket"
              description={
                assets.length === 0
                  ? 'Belum ada aset terdaftar — tambah dulu di menu "Aset IT".'
                  : 'Klik "Buat Tiket" untuk mulai.'
              }
            />
          ) : (
            <ItTicketsTable tickets={tickets} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
