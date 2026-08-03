import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItAssetsTable, type ItAsset } from "@/components/tables/it-assets-table";
import { AddItAssetButton } from "@/components/crm/add-it-asset-button";

export const dynamic = "force-dynamic";

async function getAssets(): Promise<ItAsset[] | null> {
  try {
    const res = await gatewayFetch("/it-assets?all=true");
    if (!res.ok) return null;
    const data = (await res.json()) as { assets: ItAsset[] };
    return data.assets ?? [];
  } catch {
    return null;
  }
}

export default async function ItAssetsPage() {
  const assets = await getAssets();
  return (
    <>
      <PageHeader
        title="Aset IT"
        description="Master PC/laptop kantor — tandai aset kritis (mis. PC Fakturis) supaya tiket masalahnya otomatis dapat SLA 2 jam."
        action={<AddItAssetButton />}
      />
      <Card>
        <CardContent className="pt-6">
          {!assets ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : assets.length === 0 ? (
            <EmptyState title="Belum ada aset terdaftar" description='Klik "Tambah Aset" untuk mulai.' />
          ) : (
            <ItAssetsTable assets={assets} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
