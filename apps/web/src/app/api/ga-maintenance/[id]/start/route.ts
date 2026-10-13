import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ga-maintenance/:id/start (F137).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-aset", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/ga-maintenance/${encodeURIComponent(id)}/start`, { method: "POST" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
