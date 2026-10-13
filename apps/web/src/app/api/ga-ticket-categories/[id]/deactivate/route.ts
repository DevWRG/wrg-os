import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /ga-ticket-categories/:id/deactivate (F139).
export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-helpdesk", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(
      await gatewayFetch(`/ga-ticket-categories/${encodeURIComponent(id)}/deactivate`, { method: "PATCH" }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
