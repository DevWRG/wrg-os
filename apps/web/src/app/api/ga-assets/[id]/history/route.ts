import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ga-assets/:id/history (F133).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-aset", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/ga-assets/${encodeURIComponent(id)}/history`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
