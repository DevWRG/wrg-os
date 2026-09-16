import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { DocKlaimView } from "@/components/crm/doc-klaim-view";
import type { DocKlaim } from "@/components/tables/doc-klaim-table";
import type { EmployeeOption } from "@/components/crm/add-doc-klaim-button";

export const dynamic = "force-dynamic";

async function getKlaim(): Promise<DocKlaim[]> {
  try {
    const res = await gatewayFetch("/doc-klaim");
    if (!res.ok) return [];
    const data = (await res.json()) as { klaim: DocKlaim[] };
    return data.klaim ?? [];
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

export default async function DocKlaimPage() {
  const [klaim, employees] = await Promise.all([getKlaim(), getEmployees()]);
  return (
    <>
      <PageHeader
        title="Klaim OCR"
        description="Klaim reimburse dana karyawan (kebutuhan kantor/perjalanan dinas) — foto nota masuk via WA #KLAIM, diekstrak otomatis (Gemini Vision), approve/tolak/tandai dibayar di sini."
      />
      <DocKlaimView klaim={klaim} employees={employees} />
    </>
  );
}
