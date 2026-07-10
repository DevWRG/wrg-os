import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { RaciMatrix, type RaciMatrixData } from "@/components/people/raci-matrix";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F120 RACI Matrix global — proses × karyawan (R/A/C/I) dari raci_assignment (spine F118).
export default async function RaciMatrixPage() {
  const data = await get<RaciMatrixData>("/employee-spine/raci-matrix");
  return (
    <>
      <PageHeader
        title="RACI Matrix"
        description="Matriks tanggung jawab lintas proses × karyawan (Responsible/Accountable/Consulted/Informed). (F120)"
      />
      {data ? (
        <RaciMatrix data={data} />
      ) : (
        <p className="text-muted-foreground">Data tidak tersedia. Pastikan <code>apps/api</code> jalan &amp; spine ter-seed.</p>
      )}
    </>
  );
}
