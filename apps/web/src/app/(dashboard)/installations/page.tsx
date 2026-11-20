import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddInstallationSheet } from "@/components/crm/add-installation-sheet";
import { InstallationsTable, type InstallationUnit } from "@/components/tables/installations-table";
import { JadwalSection, KapasitasSection, LaporanSection } from "./readiness-sections";

export const dynamic = "force-dynamic";

async function getInstallations(): Promise<InstallationUnit[] | null> {
  try {
    const res = await gatewayFetch("/installations");
    if (!res.ok) return null;
    const data = (await res.json()) as { units: InstallationUnit[] };
    return data.units ?? [];
  } catch {
    return null;
  }
}

// Instalasi Alat (K16, evaluasi menu 19 Nov 2026): Readiness Board — kapasitas
// teknisi, jadwal install (bergantung pada unit di sini), laporan lapangan —
// dilebur jadi tab di satu bilah. Izin tetap dua key: tab Unit = `installations`
// (induk), tiga tab lain = `readiness-board` (entri features; /readiness-board?tab=
// lama di-redirect ke tab yang sama). Hanya tab aktif yang mengambil data.
export default async function InstallationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/installations");
  const fReady = induk?.features?.find((f) => f.key === "readiness-board");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "unit", label: "Unit Instalasi" });
  if (fReady && tabVisible(me, fReady)) {
    tabs.push({ key: "kapasitas", label: "Kapasitas Teknisi" }, { key: "jadwal", label: "Jadwal Install" }, { key: "laporan", label: "Laporan Lapangan" });
  }
  const aktif = pilihTab(tabs, tab) ?? "unit";

  let isi: React.ReactNode;
  if (aktif === "kapasitas") isi = <KapasitasSection />;
  else if (aktif === "jadwal") isi = <JadwalSection />;
  else if (aktif === "laporan") isi = <LaporanSection />;
  else {
    const units = await getInstallations();
    isi = (
      <Card>
        <CardContent className="pt-6">
          {!units ? (
            <EmptyState title="Data tidak tersedia" description="Data instalasi gagal dimuat. Coba muat ulang halaman." />
          ) : units.length === 0 ? (
            <EmptyState title="Belum ada unit instalasi" description="Tambah lewat tombol Tambah Instalasi di atas." />
          ) : (
            <InstallationsTable units={units} />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Instalasi Alat"
        description="Lifecycle instalasi per alat (PO control → SJ → teknisi → training → BAST), kapasitas teknisi, jadwal install, dan laporan lapangan dari WA."
        action={aktif === "unit" ? <AddInstallationSheet /> : undefined}
      />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "unit", label: "Unit Instalasi" }]} aktif={aktif} />
      {isi}
    </>
  );
}
