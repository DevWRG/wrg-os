import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddTerritorySheet } from "@/components/watchpoint/add-territory-sheet";
import { TerritoryTable, type TerritoryRow } from "@/components/watchpoint/territory-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function getRows(): Promise<TerritoryRow[] | null> {
  try {
    const res = await gatewayFetch(`/watchpoint/territory`);
    if (!res.ok) return null;
    return ((await res.json()) as { rows: TerritoryRow[] }).rows;
  } catch {
    return null;
  }
}

export default async function TerritoryPage() {
  const rows = await getRows();
  return (
    <>
      <PageHeader
        title="WatchPoint — Territory HoD"
        description="Mapping HoD→cabang (hod_territory). Dipakai menghitung metric per-HoD. Cabang harus cocok dengan master_user.cabang."
        action={<AddTerritorySheet />}
      />
      {!rows ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Belum ada mapping. Tambah via tombol <strong>Tambah mapping</strong>.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <TerritoryTable rows={rows} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
