import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import type { PemutusKlaim } from "@/lib/doc-klaim-access";
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
  const [klaim, employees, me] = await Promise.all([getKlaim(), getEmployees(), sessionUser()]);
  // Identitas pemutus untuk menampilkan tombol yang sesuai wewenang.
  const pemutus: PemutusKlaim = {
    amId: me?.am_id ?? null,
    hodKey: me?.hod_key ?? null,
    role: me?.role ?? null,
    superuser: Boolean(me?.superuser),
    finance: (me?.groups ?? []).some((g) => g.key === "finance-hod"),
  };
  return (
    <>
      <PageHeader
        title="Klaim OCR"
        description="Klaim reimburse dana karyawan (kebutuhan kantor/perjalanan dinas) — foto nota masuk via WA #KLAIM, diekstrak otomatis (Gemini Vision), disetujui HoD pengaju, lalu ditandai dibayar oleh Finance."
      />
      <DocKlaimView klaim={klaim} employees={employees} pemutus={pemutus} />
    </>
  );
}
