import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Karyawan360 } from "@/components/karyawan/karyawan-360";
import { type Dept, type EmployeeItem, type HodOpt } from "@/components/people/employee-spine-manager";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// Karyawan 360 — hub gabungan People Analytics (editor spine) + Raport Karyawan
// (penilaian 360). Akses HoD/admin; mode Kelola hanya admin/superuser.
export default async function KaryawanPage() {
  const me = await sessionUser();
  if (!canViewRaportList(me)) {
    return (
      <>
        <PageHeader title="Karyawan 360" description="Penilaian & profil karyawan." />
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
        title="Karyawan 360"
        description="Penilaian kinerja (Raport) + profil karyawan (BSC/OKR/KPI/RACI). Kelola profil khusus admin."
      />
      <Karyawan360
        canManage={canManage}
        departments={d?.departments ?? []}
        employees={e?.employees ?? []}
        hods={h?.hods ?? []}
      />
    </>
  );
}
