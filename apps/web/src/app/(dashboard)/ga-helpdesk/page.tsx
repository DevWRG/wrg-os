import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaHelpdeskView } from "@/components/crm/ga-helpdesk-view";
import type { GaTicket } from "@/components/tables/ga-tickets-table";
import type { GaTicketCategory } from "@/components/tables/ga-ticket-categories-table";
import type { AppUserOption, AssetOption } from "@/components/crm/add-ga-ticket-button";
import type { TeknisiOption } from "@/components/crm/ga-ticket-assign-button";

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

// Dialog assign sudah lama bilang "Pilih Admin GA/Teknisi cabang penanganan"
// tapi cuma ada picker app_user + teks bebas — teknisi selalu masuk lewat
// teks bebas, gak ada picker dari roster F8 (teknisi_capacity). Ditemukan
// user 2026-09-07.
async function getTeknisi(): Promise<TeknisiOption[]> {
  try {
    const res = await gatewayFetch("/teknisi-capacity");
    if (!res.ok) return [];
    const data = (await res.json()) as { teknisi: TeknisiOption[] };
    return data.teknisi ?? [];
  } catch {
    return [];
  }
}

// Pilihan aset (opsional) di form tiket — sejak migrasi 306 Helpdesk menyerap
// Tiket IT (F52), kerusakan laptop/PC dilaporkan di sini dengan menunjuk asetnya.
async function getAssets(): Promise<AssetOption[]> {
  try {
    const res = await gatewayFetch("/ga-assets");
    if (!res.ok) return [];
    const data = (await res.json()) as { assets: (AssetOption & { active?: boolean })[] };
    return (data.assets ?? [])
      .filter((a) => a.active !== false)
      .map((a) => ({ id: a.id, asset_code: a.asset_code, nama: a.nama, is_critical: a.is_critical }));
  } catch {
    return [];
  }
}

export default async function GaHelpdeskPage() {
  const [tickets, categories, users, teknisi, assets] = await Promise.all([
    getTickets(), getCategories(), getUsers(), getTeknisi(), getAssets(),
  ]);
  return (
    <>
      <PageHeader
        title="Helpdesk GA"
        description="Ticketing kendala operasional, termasuk kerusakan laptop/PC & aset kantor lain — SLA otomatis per kategori, tracking progres, eskalasi overdue ke assignee + HoD."
      />
      <GaHelpdeskView tickets={tickets} categories={categories} users={users} teknisi={teknisi} assets={assets} />
    </>
  );
}
