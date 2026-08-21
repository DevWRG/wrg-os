import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaAssetView } from "@/components/crm/ga-asset-view";
import type { GaAsset } from "@/components/tables/ga-assets-table";
import type { GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import type { ItTicket } from "@/components/tables/it-tickets-table";
import type { AppUserOption } from "@/components/crm/ga-asset-pic-actions";

export const dynamic = "force-dynamic";

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

async function getCategories(): Promise<GaAssetCategory[]> {
  try {
    const res = await gatewayFetch("/ga-asset-categories?all=true");
    if (!res.ok) return [];
    const data = (await res.json()) as { categories: GaAssetCategory[] };
    return data.categories ?? [];
  } catch {
    return [];
  }
}

// Picker PIC (F133 assign/transfer) — akun app_user aktif.
async function getAppUsers(): Promise<AppUserOption[]> {
  try {
    const res = await gatewayFetch("/app-users");
    if (!res.ok) return [];
    const data = (await res.json()) as { users: AppUserOption[] };
    return data.users ?? [];
  } catch {
    return [];
  }
}

// Tab "Tiket IT" (F52) — diserap ke sini per arahan Direktur (1 menu, bukan
// route sendiri), sama pola F52 sendiri sebelumnya (Aset+Tiket 1 halaman).
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

export default async function GaAsetPage() {
  const [assets, categories, tickets, users] = await Promise.all([getAssets(), getCategories(), getTickets(), getAppUsers()]);
  return (
    <>
      <PageHeader
        title="Aset GA"
        description="Katalog inventaris kantor (laptop, HP, kendaraan, mebel, software) + tiket masalah aset IT — single source of truth aset, dasar assignment & maintenance."
      />
      <GaAssetView assets={assets} categories={categories} tickets={tickets} users={users} />
    </>
  );
}
