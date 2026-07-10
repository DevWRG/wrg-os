import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";
import { OrgChart } from "@/components/people/org-chart";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F129 Org Chart (ORG_BASIC) — struktur organisasi per departemen dari spine F118.
export default async function OrgChartPage() {
  const [d, e] = await Promise.all([
    get<{ departments: Dept[] }>("/employee-spine/departments"),
    get<{ employees: EmployeeItem[] }>("/employee-spine/employees"),
  ]);
  return (
    <>
      <PageHeader
        title="Org Chart"
        description="Struktur organisasi per departemen (ORG_BASIC) dari Employee Spine. (F129)"
      />
      <OrgChart departments={d?.departments ?? []} employees={e?.employees ?? []} />
    </>
  );
}
