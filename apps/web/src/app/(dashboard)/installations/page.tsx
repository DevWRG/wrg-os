import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddInstallationSheet } from "@/components/crm/add-installation-sheet";
import { InstallationsTable, type InstallationUnit } from "@/components/tables/installations-table";

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

export default async function InstallationsPage() {
  const units = await getInstallations();
  return (
    <>
      <PageHeader
        title="Instalasi Alat"
        description="Checklist lifecycle instalasi per alat: PO control → SJ → Teknisi assign → Training done → BAST."
        action={<AddInstallationSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!units ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : units.length === 0 ? (
            <EmptyState title="Belum ada unit instalasi" description="Tambah lewat tombol di atas." />
          ) : (
            <InstallationsTable units={units} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
