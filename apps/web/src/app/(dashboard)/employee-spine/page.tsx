import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmployeeSpineManager, type Dept, type EmployeeItem } from "@/components/people/employee-spine-manager";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F118 Employee Profile Spine — 53 karyawan × BSC/OKR/KPI/PDCA/RACI/Voice + kalkulator skor BSC (F119).
export default async function EmployeeSpinePage() {
  const [d, e] = await Promise.all([
    get<{ departments: Dept[] }>("/employee-spine/departments"),
    get<{ employees: EmployeeItem[] }>("/employee-spine/employees"),
  ]);
  return (
    <>
      <PageHeader
        title="Employee Spine"
        description="Profil karyawan per BSC→OKR→KPI→PDCA→RACI + Voice + kalkulator skor BSC tertimbang. (F118/F119)"
      />
      <EmployeeSpineManager departments={d?.departments ?? []} employees={e?.employees ?? []} />
    </>
  );
}
