import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { DigestsView, type History } from "@/components/digests/digests-view";

export const dynamic = "force-dynamic";

async function getHistory(): Promise<History | null> {
  try {
    const res = await gatewayFetch(`/digests`);
    if (!res.ok) return null;
    return (await res.json()) as History;
  } catch {
    return null;
  }
}

export default async function DigestsPage() {
  const data = await getHistory();

  return (
    <>
      <PageHeader
        title="Digest History"
        description="Rekap & resume eksekutif monitor — riwayat teks + infografis, data live dari DB."
      />
      <DigestsView history={data} />
    </>
  );
}
