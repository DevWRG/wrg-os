import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CapacityCards, type TeknisiReadiness } from "@/components/tables/capacity-cards";
import { AddScheduleSheet } from "@/components/crm/add-schedule-sheet";
import { InstallScheduleTable, type InstallSchedule } from "@/components/tables/install-schedule-table";
import { AddReportSheet } from "@/components/crm/add-report-sheet";
import { TeknisiReportsTable, type TeknisiReport } from "@/components/tables/teknisi-reports-table";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function ReadinessBoardPage() {
  const [boardRes, scheduleRes, reportsRes] = await Promise.all([
    getJson<{ board: TeknisiReadiness[] }>("/readiness-board"),
    getJson<{ rows: InstallSchedule[] }>("/install-schedule"),
    getJson<{ rows: TeknisiReport[] }>("/teknisi-reports"),
  ]);
  const board = boardRes?.board ?? null;
  const schedule = scheduleRes?.rows ?? null;
  const reports = reportsRes?.rows ?? null;

  return (
    <>
      <PageHeader
        title="Readiness Board"
        description="Kapasitas teknisi, jadwal install (dari Instalasi Alat), dan laporan lapangan (#install/#servis/#training/#kalibrasi)."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Kapasitas Teknisi</CardTitle>
        </CardHeader>
        <CardContent>
          {!board ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan." />
          ) : board.length === 0 ? (
            <EmptyState title="Belum ada teknisi" description="Seed teknisi_capacity via scripts/db/seed-dev-full.sql." />
          ) : (
            <CapacityCards board={board} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between pb-2">
          <CardTitle className="text-base">Install Schedule</CardTitle>
          <AddScheduleSheet />
        </CardHeader>
        <CardContent>
          {!schedule ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan." />
          ) : schedule.length === 0 ? (
            <EmptyState title="Belum ada jadwal install" description="Tambah lewat tombol di atas (alat harus terdaftar dulu di Instalasi Alat)." />
          ) : (
            <InstallScheduleTable schedule={schedule} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between pb-2">
          <CardTitle className="text-base">Laporan Terbaru</CardTitle>
          <AddReportSheet />
        </CardHeader>
        <CardContent>
          {!reports ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan." />
          ) : reports.length === 0 ? (
            <EmptyState title="Belum ada laporan" description="Tambah manual lewat tombol di atas, atau lewat #install/#servis/#training/#kalibrasi di WA." />
          ) : (
            <TeknisiReportsTable reports={reports} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
