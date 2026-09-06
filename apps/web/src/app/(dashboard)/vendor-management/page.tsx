import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { sessionUser } from "@/lib/admin-guard";
import { canViewVendorManagement } from "@/lib/vendor-management-access";
import { AddVendorSheet } from "@/components/vendor-management/add-vendor-sheet";
import { VendorTable, type VendorPartnerRow } from "@/components/vendor-management/vendor-table";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// F140 Vendor Management + Contract Expiry Alerts — role min HOD. Gate
// identitas di sini (server component) + requireHodOrAdmin() di BFF (2 lapis,
// pola sama F40/F51) — data kontrak/nilai komersial vendor dianggap sensitif.
export default async function VendorManagementPage() {
  const me = await sessionUser();
  if (!canViewVendorManagement(me)) {
    return (
      <>
        <PageHeader title="Vendor Management" description="Master vendor/partner + pemantauan masa berlaku kontrak." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }

  const data = await getJson<{ rows: VendorPartnerRow[] }>("/vendor-management");

  return (
    <>
      <PageHeader
        title="Vendor Management"
        description="Master vendor/partner lokal + riwayat kontrak & status masa berlaku (F140)."
        action={<AddVendorSheet />}
      />
      {!data ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Pastikan apps/api jalan dengan DATABASE_URL dan migrasi 145_vendor_management.sql sudah diterapkan."
        />
      ) : (
        <VendorTable rows={data.rows ?? []} />
      )}
    </>
  );
}
