import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CapacityCards, type TeknisiReadiness } from "@/components/tables/capacity-cards";
import { AddScheduleSheet } from "@/components/crm/add-schedule-sheet";
import { InstallScheduleTable, type InstallSchedule } from "@/components/tables/install-schedule-table";
import { AddReportSheet } from "@/components/crm/add-report-sheet";
import { TeknisiReportsTable, type TeknisiReport } from "@/components/tables/teknisi-reports-table";

// Tiga tab bekas Readiness Board (K16, evaluasi menu 19 Nov 2026) — izin key
// `readiness-board`. Tiap section mengambil datanya sendiri, jadi hanya tab aktif
// yang memanggil API.
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function KapasitasSection() {
  const board = (await getJson<{ board: TeknisiReadiness[] }>("/readiness-board"))?.board ?? null;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between pb-2">
        <CardTitle className="text-base">Kapasitas Teknisi</CardTitle>
        <p className="text-muted-foreground text-xs">
          Daftar dari <Link href="/users" className="underline underline-offset-2">Pengguna</Link> (role Teknisi) · wilayah dari{" "}
          <Link href="/jadwal-teknisi" className="underline underline-offset-2">Jadwal Teknisi</Link>
        </p>
      </CardHeader>
      <CardContent>
        {!board ? (
          <EmptyState title="Data tidak tersedia" description="Data kapasitas gagal dimuat. Coba muat ulang halaman." />
        ) : board.length === 0 ? (
          <EmptyState title="Belum ada teknisi" description="Tambahkan karyawan dengan role Teknisi di menu Pengguna." />
        ) : (
          <CapacityCards board={board} />
        )}
      </CardContent>
    </Card>
  );
}

export async function JadwalSection() {
  const schedule = (await getJson<{ rows: InstallSchedule[] }>("/install-schedule"))?.rows ?? null;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between pb-2">
        <CardTitle className="text-base">Jadwal Install</CardTitle>
        <AddScheduleSheet />
      </CardHeader>
      <CardContent>
        {!schedule ? (
          <EmptyState title="Data tidak tersedia" description="Jadwal install gagal dimuat. Coba muat ulang halaman." />
        ) : schedule.length === 0 ? (
          <EmptyState title="Belum ada jadwal install" description="Tambah lewat tombol di atas (alat harus terdaftar dulu di tab Unit Instalasi)." />
        ) : (
          <InstallScheduleTable schedule={schedule} />
        )}
      </CardContent>
    </Card>
  );
}

export async function LaporanSection() {
  const reports = (await getJson<{ rows: TeknisiReport[] }>("/teknisi-reports"))?.rows ?? null;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between pb-2">
        <CardTitle className="text-base">Laporan Lapangan Terbaru</CardTitle>
        <AddReportSheet />
      </CardHeader>
      <CardContent>
        {!reports ? (
          <EmptyState title="Data tidak tersedia" description="Laporan gagal dimuat. Coba muat ulang halaman." />
        ) : reports.length === 0 ? (
          <EmptyState title="Belum ada laporan" description="Tambah manual lewat tombol di atas, atau lewat #install/#servis/#training/#kalibrasi di WA." />
        ) : (
          <TeknisiReportsTable reports={reports} />
        )}
      </CardContent>
    </Card>
  );
}
