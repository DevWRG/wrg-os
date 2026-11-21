import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Karyawan360 } from "@/components/karyawan/karyawan-360";
import { type Dept, type EmployeeItem, type HodOpt } from "@/components/people/employee-spine-manager";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";
import { findNavItem, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageTabs } from "@/components/layout/page-tabs";
import { CoachingSection } from "./coaching-section";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// Karyawan 360 — hub gabungan People Analytics (editor spine) + Raport Karyawan
// (penilaian 360). Akses HoD/admin; mode Kelola hanya admin/superuser.
//
// K18 opsi C (evaluasi menu 19 Nov 2026): Coaching Notes dilebur jadi tab "Catatan
// Coaching" — penilaian per orang di satu tempat. Izin tetap key `coaching`
// (/coaching → ?tab=coaching). Voice of Employee sengaja TETAP menu sendiri.
export default async function KaryawanPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [me, { tab }] = await Promise.all([sessionUser(), searchParams]);
  const fCoaching = findNavItem("/karyawan")?.features?.find((f) => f.key === "coaching");
  const bolehRaport = canViewRaportList(me);
  const bolehCoaching = !!fCoaching && tabVisible(me, fCoaching);
  const tabs: DefTab[] = [];
  if (bolehRaport) tabs.push({ key: "raport", label: "Raport & Profil" });
  if (bolehCoaching) tabs.push({ key: "coaching", label: "Catatan Coaching" });
  const aktif = pilihTab(tabs, tab);

  if (aktif === "coaching") {
    return (
      <>
        <PageHeader title="Raport Karyawan 360" description="Penilaian kinerja, profil karyawan, dan catatan coaching per Account Manager." />
        <PageTabs tabs={tabs} aktif={aktif} />
        <CoachingSection />
      </>
    );
  }
  if (!bolehRaport) {
    return (
      <>
        <PageHeader title="Raport Karyawan 360" description="Penilaian & profil karyawan." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }
  const canManage = me?.role === "admin" || me?.superuser === true;
  const [d, e, h] = canManage
    ? await Promise.all([
        get<{ departments: Dept[] }>("/employee-spine/departments"),
        get<{ employees: EmployeeItem[] }>("/employee-spine/employees"),
        get<{ hods: HodOpt[] }>("/employee-spine/hods"),
      ])
    : [null, null, null];

  return (
    <>
      <PageHeader
        title="Raport Karyawan 360"
        description="Penilaian kinerja, profil karyawan (BSC/OKR/KPI/RACI), dan catatan coaching per Account Manager. Kelola profil khusus admin."
      />
      <PageTabs tabs={tabs} aktif="raport" />
      <Karyawan360
        canManage={canManage}
        departments={d?.departments ?? []}
        employees={e?.employees ?? []}
        hods={h?.hods ?? []}
      />
    </>
  );
}
