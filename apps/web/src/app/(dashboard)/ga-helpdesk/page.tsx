import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaHelpdeskView } from "@/components/crm/ga-helpdesk-view";
import type { GaTicket } from "@/components/tables/ga-tickets-table";
import type { GaTicketCategory } from "@/components/tables/ga-ticket-categories-table";
import type { AppUserOption } from "@/components/crm/add-ga-ticket-button";

export const dynamic = "force-dynamic";

async function getTickets(): Promise<GaTicket[]> {
  try {
    const res = await gatewayFetch("/ga-tickets");
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets: GaTicket[] };
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

async function getCategories(): Promise<GaTicketCategory[]> {
  try {
    const res = await gatewayFetch("/ga-ticket-categories");
    if (!res.ok) return [];
    const data = (await res.json()) as { categories: GaTicketCategory[] };
    return data.categories ?? [];
  } catch {
    return [];
  }
}

async function getUsers(): Promise<AppUserOption[]> {
  try {
    const res = await gatewayFetch("/app-users");
    if (!res.ok) return [];
    const data = (await res.json()) as { users: AppUserOption[] };
    return data.users ?? [];
  } catch {
    return [];
  }
}

export default async function GaHelpdeskPage() {
  const [tickets, categories, users] = await Promise.all([getTickets(), getCategories(), getUsers()]);
  return (
    <>
      <PageHeader
        title="Helpdesk GA"
        description="Ticketing kendala operasional — SLA otomatis per kategori, tracking progres, eskalasi overdue ke assignee + HoD."
      />
      <GaHelpdeskView tickets={tickets} categories={categories} users={users} />
    </>
  );
}
