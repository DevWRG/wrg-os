import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductsTable, type AccurateItem } from "@/components/tables/products-table";

export const dynamic = "force-dynamic";

async function getItems(): Promise<AccurateItem[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/items?limit=2000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: AccurateItem[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function ProductsPage() {
  const items = await getItems();
  return (
    <>
      <PageHeader title="Products" description="Katalog item dari Accurate (accurate_item) — disinkron dari sales-invoice." />
      <Card>
        <CardContent className="pt-6">
          {!items ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : items.length === 0 ? (
            <EmptyState title="Belum ada item" description="Mirror accurate_item kosong — jalankan sinkron Accurate." />
          ) : (
            <ProductsTable items={items} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
