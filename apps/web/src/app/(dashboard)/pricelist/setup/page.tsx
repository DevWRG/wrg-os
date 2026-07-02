import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditPricelistSetup, canPublishPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SetupPricelistClient } from "@/components/pricelist/setup-pricelist-client";
import type { ProductOption } from "@/components/pricelist/pricelist-form-sheet";
import type { PricelistRow } from "@/lib/pricelist";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function PricelistSetupPage() {
  const me = await sessionUser();
  if (!canEditPricelistSetup(me)) {
    return (
      <>
        <PageHeader title="Pricelist Setup" description="Susun & publikasikan harga jual produk." />
        <p className="text-muted-foreground">
          Akses ditolak — hanya HoD Business / Purchasing (atau admin) yang bisa mengelola setup pricelist.
        </p>
      </>
    );
  }

  const [pl, prod] = await Promise.all([
    getJson<{ rows: PricelistRow[] }>("/pricelist"),
    getJson<{ rows: { id: string | number; no: string | null; name: string | null }[] }>(
      "/accurate/items?limit=10000",
    ),
  ]);
  const products: ProductOption[] = (prod?.rows ?? []).map((p) => ({
    id: String(p.id),
    no: p.no,
    name: p.name,
  }));

  return (
    <>
      <PageHeader
        title="Pricelist Setup"
        description="Basis Harga Principal (HPP), margin, diskon, insentif & konfirmasi area. Publikasikan agar tampil di menu Pricelist (AM)."
      />
      {!pl ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code> dan migrasi{" "}
          <code>043_pricelist.sql</code> sudah diterapkan.
        </p>
      ) : (
        <div className="min-w-0">
          <Card>
            <CardContent className="pt-6">
              <SetupPricelistClient
                rows={pl.rows ?? []}
                products={products}
                canPublish={canPublishPricelist(me)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
