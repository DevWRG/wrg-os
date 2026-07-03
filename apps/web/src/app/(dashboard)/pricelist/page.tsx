import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AmPricelistTable } from "@/components/pricelist/am-pricelist-table";
import type { PricelistRow } from "@/lib/pricelist";

export const dynamic = "force-dynamic";

async function getRows(): Promise<PricelistRow[] | null> {
  try {
    const res = await gatewayFetch(`/pricelist?status=published`);
    if (!res.ok) return null;
    return ((await res.json()) as { rows: PricelistRow[] }).rows ?? [];
  } catch {
    return null;
  }
}

export default async function PricelistPage() {
  const me = await sessionUser();
  if (!canViewPricelist(me)) {
    return (
      <>
        <PageHeader title="Pricelist" description="Harga jual produk terpublikasi." />
        <p className="text-muted-foreground">Akses ditolak — halaman ini untuk Account Manager.</p>
      </>
    );
  }
  const rows = await getRows();
  return (
    <>
      <PageHeader
        title="Pricelist"
        description="Harga jual terpublikasi: Price List, Diskon, Nett Price, Price + PPN."
      />
      {!rows ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada pricelist terpublikasi" description="HoD Business belum mempublikasikan harga." />
      ) : (
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <AmPricelistTable rows={rows} />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
