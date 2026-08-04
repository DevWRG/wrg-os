import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canApproveGaFinance } from "@/lib/ga-maintenance-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaAssetView } from "@/components/crm/ga-asset-view";
import type { GaAsset } from "@/components/tables/ga-assets-table";
import type { GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import type { GaMaintenance } from "@/components/tables/ga-maintenance-table";
import type { GaVendor } from "@/components/tables/ga-vendor-table";
import type { AppUserOption } from "@/components/crm/ga-maintenance-actions";

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

export default async function GaAsetPage() {
  const [assets, categories, schedules, vendors, users, me] = await Promise.all([
    getAssets(), getCategories(), getSchedules(), getVendors(), getAppUsers(), sessionUser(),
  ]);
  return (
    <>
      <PageHeader
        title="Aset GA"
        description="Katalog inventaris kantor + jadwal maintenance & vendor — single source of truth aset, dasar assignment & maintenance."
      />
      <GaAssetView
        assets={assets} categories={categories} schedules={schedules} vendors={vendors}
        canApproveFinance={canApproveGaFinance(me)} users={users}
      />
    </>
  );
}
