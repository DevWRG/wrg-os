import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ga-tickets/:id/timeline (F139).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-helpdesk", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/ga-tickets/${encodeURIComponent(id)}/timeline`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
