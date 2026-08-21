import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { sessionUser } from "@/lib/admin-guard";
import { canViewInventoryRelocation } from "@/lib/inventory-relocation-access";
import { AddInventoryRelocationSheet } from "@/components/purchasing/add-inventory-relocation-sheet";
import { InventoryRelocationTable, type InventoryRelocationRow } from "@/components/purchasing/inventory-relocation-table";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// F40 Inventory Relocation Request — role min HOD. Gate identitas di sini
// (server component) + requireHodOrAdmin() di BFF (2 lapis, pola sama dgn
// F51 Dana Ops/Karyawan 360) — beda dari F25/F39/F134 yg role min Karyawan.
export default async function InventoryRelocationsPage() {
  const me = await sessionUser();
  if (!canViewInventoryRelocation(me)) {
    return (
      <>
        <PageHeader title="Relokasi Inventaris" description="Permintaan pemindahan barang antar cabang." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }

  const data = await getJson<{ rows: InventoryRelocationRow[] }>("/inventory-relocations");

  return (
    <>
      <PageHeader
        title="Relokasi Inventaris"
        description="Catat & lacak permintaan pemindahan barang antar cabang (F40)."
        action={<AddInventoryRelocationSheet />}
      />
      {!data ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Pastikan apps/api jalan dengan DATABASE_URL dan migrasi 078_inventory_relocation_request.sql sudah diterapkan."
        />
      ) : (
        <InventoryRelocationTable rows={data.rows ?? []} />
      )}
    </>
  );
}
