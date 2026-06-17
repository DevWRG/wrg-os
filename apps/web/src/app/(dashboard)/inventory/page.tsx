import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InventoryTable, type InventoryItem } from "@/components/tables/inventory-table";

export const dynamic = "force-dynamic";

async function getItems(): Promise<InventoryItem[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/items?limit=10000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: InventoryItem[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function InventoryPage() {
  const items = await getItems();
  return (
    <>
      <PageHeader title="Inventory" description="Stok item dari Accurate (quantity & available) — disinkron dari katalog item." />
      <Card>
        <CardContent className="pt-6">
          {!items ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : items.length === 0 ? (
            <EmptyState title="Belum ada item" description="Jalankan sinkron: POST /accurate/sync/items." />
          ) : (
            <InventoryTable items={items} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
