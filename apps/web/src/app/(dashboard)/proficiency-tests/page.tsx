import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AddProficiencyTestSheet } from "@/components/aftersales/add-proficiency-test-sheet";
import { ProficiencyTestTable, type ProficiencyTestRow } from "@/components/aftersales/proficiency-test-table";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function ProficiencyTestsPage() {
  const data = await getJson<{ rows: ProficiencyTestRow[] }>("/aftersales/proficiency-tests");

  return (
    <>
      <PageHeader
        title="Uji Profisiensi"
        description="Registry sertifikat Uji Profisiensi per RS/faskes — tracking tanggal ED untuk renewal tahunan (F25)."
        action={<AddProficiencyTestSheet />}
      />
      {!data ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Pastikan apps/api jalan dengan DATABASE_URL dan migrasi 077_proficiency_test_document.sql sudah diterapkan."
        />
      ) : (
        <ProficiencyTestTable rows={data.rows ?? []} />
      )}
    </>
  );
}
