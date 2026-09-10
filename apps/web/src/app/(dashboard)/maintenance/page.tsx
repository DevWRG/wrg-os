import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddMaintenanceSheet } from "@/components/crm/add-maintenance-sheet";
import { MaintenanceTable, type MaintenanceSchedule } from "@/components/tables/maintenance-table";

export const dynamic = "force-dynamic";

async function getSchedules(): Promise<MaintenanceSchedule[] | null> {
  try {
    const res = await gatewayFetch("/maintenance");
    if (!res.ok) return null;
    const data = (await res.json()) as { schedules: MaintenanceSchedule[] };
    return data.schedules ?? [];
  } catch {
    return null;
  }
}

export default async function MaintenancePage() {
  const schedules = await getSchedules();
  return (
    <>
      <PageHeader
        title="PM & Kalibrasi"
        description="Schedule preventive maintenance & kalibrasi per alat, reminder H-14 ke teknisi sebelum jatuh tempo."
        action={<AddMaintenanceSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!schedules ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : schedules.length === 0 ? (
            <EmptyState title="Belum ada schedule PM/kalibrasi" description="Tambah lewat tombol di atas (alat harus sudah BAST di Instalasi Alat)." />
          ) : (
            <MaintenanceTable schedules={schedules} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
