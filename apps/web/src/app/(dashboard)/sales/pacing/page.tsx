import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { TargetPacingView, type PacingData } from "@/components/sales/target-pacing-view";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// Target Pacing — target vs actual YTD + proyeksi (on-track/at-risk/behind) per AM & cabang.
export default async function PacingPage() {
  const data = await get<PacingData>("/sales/pacing");
  return (
    <>
      <PageHeader
        title="Target Pacing"
        description="Target vs actual (YTD) + proyeksi akhir tahun — on-track / at-risk / behind, per AM & cabang."
      />
      {data ? (
        <TargetPacingView data={data} />
      ) : (
        <p className="text-muted-foreground">Data tidak tersedia. Pastikan <code>apps/api</code> jalan.</p>
      )}
    </>
  );
}
