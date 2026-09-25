import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { LpseTenderView } from "@/components/crm/lpse-tender-view";
import type { LpseTender } from "@/components/tables/lpse-tender-table";
import type { EmployeeOption } from "@/components/crm/add-lpse-tender-button";

export const dynamic = "force-dynamic";

async function getTenders(): Promise<LpseTender[]> {
  try {
    const res = await gatewayFetch("/lpse-tender");
    if (!res.ok) return [];
    const data = (await res.json()) as { tenders: LpseTender[] };
    return data.tenders ?? [];
  } catch {
    return [];
  }
}

async function getEmployees(): Promise<EmployeeOption[]> {
  try {
    const res = await gatewayFetch("/employee-spine/employees");
    if (!res.ok) return [];
    const data = (await res.json()) as { employees: EmployeeOption[] };
    return data.employees ?? [];
  } catch {
    return [];
  }
}

export default async function LpseTenderPage() {
  const [tenders, employees] = await Promise.all([getTenders(), getEmployees()]);
  return (
    <>
      <PageHeader
        title="LPSE / E-Catalog Tracker"
        description="Status klik per tender (pesan masuk → barang dikirim → selesai) + reminder kalau macet."
      />
      <LpseTenderView tenders={tenders} employees={employees} />
    </>
  );
}
