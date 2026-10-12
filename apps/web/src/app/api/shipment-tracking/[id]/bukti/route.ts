import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /shipment-tracking/:id/bukti (F93, audit trail
// tambahan setelah BAST: foto bukti terima + scan tanda tangan).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/shipment-tracking", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const res = await gatewayFetch(`/shipment-tracking/${encodeURIComponent(id)}/bukti`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // photo_path TIDAK diteruskan: UI web tak punya upload, dan path dari klien
      // dulu bisa mengisi kedua slot bukti dengan sampah selamanya. Foto bukti
      // hanya sah dari WA #BUKTI (media_path bridge).
      body: JSON.stringify({ by: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
