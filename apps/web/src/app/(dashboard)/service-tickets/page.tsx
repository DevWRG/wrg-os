import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddTicketSheet } from "@/components/crm/add-ticket-sheet";
import { ServiceTicketsTable, type ServiceTicket } from "@/components/tables/service-tickets-table";

export const dynamic = "force-dynamic";

async function getTickets(): Promise<ServiceTicket[] | null> {
  try {
    const res = await gatewayFetch("/service-tickets");
    if (!res.ok) return null;
    const data = (await res.json()) as { tickets: ServiceTicket[] };
    return data.tickets ?? [];
  } catch {
    return null;
  }
}

export default async function ServiceTicketsPage() {
  const tickets = await getTickets();
  return (
    <>
      <PageHeader
        title="Service Tickets"
        description="Triage komplain customer via LLM: severity tag → auto-assign teknisi (by area) → ETA."
        action={<AddTicketSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!tickets ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api & services/ai jalan." />
          ) : tickets.length === 0 ? (
            <EmptyState title="Belum ada ticket" description="Tambah lewat tombol di atas (simulasi komplain, tanpa perlu grup WA)." />
          ) : (
            <ServiceTicketsTable tickets={tickets} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
