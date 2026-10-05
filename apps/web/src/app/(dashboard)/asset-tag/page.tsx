import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AssetTagView } from "@/components/crm/asset-tag-view";
import type { AssetTag } from "@/components/tables/asset-tags-table";

export const dynamic = "force-dynamic";

async function getAssets(): Promise<AssetTag[] | null> {
  try {
    const res = await gatewayFetch("/asset-tags?all=true");
    if (!res.ok) return null;
    const data = (await res.json()) as { assets: AssetTag[] };
    return data.assets ?? [];
  } catch {
    return null;
  }
}

export default async function AssetTagPage() {
  const assets = await getAssets();
  return (
    <>
      <PageHeader
        title="Stiker Aset & Asset Tagging Audit"
        description="Registry aset yang ditag QR-code + cetak stiker + riwayat verifikasi fisik berkala."
      />
      {!assets ? (
        <p className="text-muted-foreground text-sm">Data tidak tersedia — pastikan apps/api jalan & DATABASE_URL terisi.</p>
      ) : (
        <AssetTagView assets={assets} />
      )}
    </>
  );
}
