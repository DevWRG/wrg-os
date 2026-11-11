import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaAssetView } from "@/components/crm/ga-asset-view";
import type { GaAsset } from "@/components/tables/ga-assets-table";
import type { GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import { sessionUser } from "@/lib/admin-guard";
import { canApproveGaFinance } from "@/lib/ga-maintenance-access";
import type { GaMaintenance } from "@/components/tables/ga-maintenance-table";
import type { GaVendor } from "@/components/tables/ga-vendor-table";
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

// F137 — jadwal maintenance + vendor GA, tab tambahan di halaman yang sama.
async function getSchedules(): Promise<GaMaintenance[]> {
  try {
    const res = await gatewayFetch("/ga-maintenance");
    if (!res.ok) return [];
    const data = (await res.json()) as { schedules: GaMaintenance[] };
    return data.schedules ?? [];
  } catch {
    return [];
  }
}

async function getVendors(): Promise<GaVendor[]> {
  try {
    const res = await gatewayFetch("/ga-vendors?all=true");
    if (!res.ok) return [];
    const data = (await res.json()) as { vendors: GaVendor[] };
    return data.vendors ?? [];
  } catch {
    return [];
  }
}

export default async function GaAsetPage() {
  const [assets, categories, users, schedules, vendors, me] = await Promise.all([
    getAssets(), getCategories(), getAppUsers(), getSchedules(), getVendors(), sessionUser(),
  ]);
  return (
    <>
      <PageHeader
        title="Aset GA"
        description="Katalog inventaris kantor (laptop, HP, kendaraan, mebel, software), jadwal maintenance & vendor GA — single source of truth aset. Kerusakan aset dilaporkan lewat Helpdesk GA."
      />
      <GaAssetView
        assets={assets} categories={categories} users={users}
        schedules={schedules} vendors={vendors} canApproveFinance={canApproveGaFinance(me)}
      />
    </>
  );
}
