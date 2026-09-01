import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PipelineBoard, type PipelineData } from "@/components/pipeline/pipeline-board";
import { LossApprovalPanel } from "@/components/pipeline/loss-approval-panel";

export const dynamic = "force-dynamic";

// Teruskan x-user-id → backend resolveScope (AM deal sendiri / HoD cabang / admin
// semua). Tanpa header ini scope jadi FULL_SCOPE (lihat semua) — tetap aman, tapi
// tak ter-scope per user; maka kita kirim identitas dari sesi.
async function getPipeline(userId: string | undefined): Promise<PipelineData | null> {
  try {
    const res = await gatewayFetch(`/pipeline`, userId ? { headers: { "x-user-id": userId } } : undefined);
    if (!res.ok) return null;
    return (await res.json()) as PipelineData;
  } catch {
    return null;
  }
}

export default async function PipelinePage() {
  const me = await sessionUser();
  const data = await getPipeline(me?.id);
  // Admin = role 'admin' (lama) atau superuser (RBAC) — gate tombol Hapus deal.
  const isAdmin = me?.role === "admin" || me?.superuser === true;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sales Pipeline (F1)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Digitalisasi HS-S-1. Tab <b>Pipeline</b> = board 7-stage (seret kartu untuk pindah stage; klik untuk detail),
          tab <b>Infografis</b> = grafik dari irisan filter yang sama.
        </p>
      </div>
      {/* Panel approval Lost — hanya tampil bila user (HoD/admin) punya loss pending. */}
      <LossApprovalPanel />
      {data ? (
        <PipelineBoard data={data} isAdmin={isAdmin} />
      ) : (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      )}
    </div>
  );
}
