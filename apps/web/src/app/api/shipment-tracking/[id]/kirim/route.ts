import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /shipment-tracking/:id/kirim (F12 langkah 1: draft → dikirim).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/shipment-tracking", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const res = await gatewayFetch(`/shipment-tracking/${encodeURIComponent(id)}/kirim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Jalur web = override manual: pelaku dari sesi, TANPA lat/lon/photo dari
      // klien (koordinat & foto hanya sah dari WA ber-geotag).
      body: JSON.stringify({ by: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
