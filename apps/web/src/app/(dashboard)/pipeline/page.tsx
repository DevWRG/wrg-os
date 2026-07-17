import { gatewayFetch } from "@/lib/gateway";
import { PipelineBoard, type PipelineData } from "@/components/pipeline/pipeline-board";

export const dynamic = "force-dynamic";

async function getPipeline(): Promise<PipelineData | null> {
  try {
    const res = await gatewayFetch(`/pipeline`);
    if (!res.ok) return null;
    return (await res.json()) as PipelineData;
  } catch {
    return null;
  }
}

export default async function PipelinePage() {
  const data = await getPipeline();

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sales Pipeline (F1)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Board 8-stage pipeline penjualan (digitalisasi HS-S-1). Read-only — klik deal untuk detail.
        </p>
      </div>
      {data ? (
        <PipelineBoard data={data} />
      ) : (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      )}
    </div>
  );
}
