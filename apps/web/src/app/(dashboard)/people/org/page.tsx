import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";
import { OrgChart, type OrgReporting } from "@/components/people/org-chart";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F129 Org Chart — Per Departemen (ORG_BASIC) + Reporting Line (ORG_OPTIMAL, via
// HoD resolver F121). Dari Employee Spine F118.
export default async function OrgChartPage() {
  const [d, e, r] = await Promise.all([
    get<{ departments: Dept[] }>("/employee-spine/departments"),
    get<{ employees: EmployeeItem[] }>("/employee-spine/employees"),
    get<OrgReporting>("/employee-spine/org-reporting"),
  ]);
  return (
    <>
      <PageHeader
        title="Org Chart"
        description="Struktur organisasi — Per Departemen (ORG_BASIC) & Reporting Line (ORG_OPTIMAL, via HoD resolver). (F129)"
      />
      <OrgChart departments={d?.departments ?? []} employees={e?.employees ?? []} reporting={r} />
    </>
  );
}
