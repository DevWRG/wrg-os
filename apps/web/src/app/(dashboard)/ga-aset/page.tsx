import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaAssetView } from "@/components/crm/ga-asset-view";
import type { GaAsset } from "@/components/tables/ga-assets-table";
import type { GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import { sessionUser } from "@/lib/admin-guard";
import { canApproveGaFinance } from "@/lib/ga-maintenance-access";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import type { GaRelocation } from "@/components/tables/ga-relocation-table";
import { RelokasiPanel } from "@/components/crm/ga-asset-view";
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

async function getRelocations(): Promise<GaRelocation[] | null> {
  try {
    const res = await gatewayFetch("/ga-asset-relocations");
    if (!res.ok) return null;
    const data = (await res.json()) as { relocations: GaRelocation[] };
    return data.relocations ?? [];
  } catch {
    return null;
  }
}

// K6 (evaluasi menu 19 Nov 2026): Relokasi Aset dilebur jadi tab "Riwayat Relokasi".
// Izin tetap dua: data Aset GA = key `ga-aset` (+ sub-izin ga-finance-approval),
// tab relokasi = key `ga-relokasi`. Data yang tak diizinkan tak diambil sama sekali.
export default async function GaAsetPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/ga-aset");
  const fRelokasi = induk?.features?.find((f) => f.key === "ga-relokasi");
  const bolehInduk = !induk || navOwnVisible(me, induk);
  const bolehRelokasi = !!fRelokasi && tabVisible(me, fRelokasi);
  const relokasi = bolehRelokasi ? await getRelocations() : undefined;

  // Pemegang tab relokasi saja (tanpa izin Aset GA) → hanya riwayat relokasi.
  if (!bolehInduk) {
    return (
      <>
        <PageHeader title="Riwayat Relokasi Aset" description="Riwayat pindah lokasi aset GA beserta berita acara bertanda tangan." />
        <RelokasiPanel rows={relokasi ?? null} />
      </>
    );
  }

  const [assets, categories, users, schedules, vendors] = await Promise.all([
    getAssets(), getCategories(), getAppUsers(), getSchedules(), getVendors(),
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
        relokasi={relokasi} tabAwal={tab}
      />
    </>
  );
}
