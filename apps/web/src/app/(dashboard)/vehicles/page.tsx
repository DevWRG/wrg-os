import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddVehicleSheet } from "@/components/crm/add-vehicle-sheet";
import { VehiclesTable, type Vehicle } from "@/components/tables/vehicles-table";

export const dynamic = "force-dynamic";

async function getVehicles(): Promise<Vehicle[] | null> {
  try {
    const res = await gatewayFetch("/vehicles");
    if (!res.ok) return null;
    const data = (await res.json()) as { vehicles: Vehicle[] };
    return data.vehicles ?? [];
  } catch {
    return null;
  }
}

export default async function VehiclesPage() {
  const vehicles = await getVehicles();
  return (
    <>
      <PageHeader
        title="Kendaraan Operasional"
        description="Log per kendaraan (km, BBM, service, STNK, sopir) + alert otomatis kalau service atau STNK jatuh tempo."
        action={<AddVehicleSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!vehicles ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : vehicles.length === 0 ? (
            <EmptyState
              title="Belum ada kendaraan terdaftar"
              description="Tambah lewat tombol di atas."
            />
          ) : (
            <VehiclesTable vehicles={vehicles} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
