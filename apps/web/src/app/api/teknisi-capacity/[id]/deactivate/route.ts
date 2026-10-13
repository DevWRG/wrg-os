import { requireFeature } from "@/lib/feature-guard";
import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /teknisi-capacity/:id/deactivate (F8).
export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/readiness-board", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(
      await gatewayFetch(`/teknisi-capacity/${encodeURIComponent(id)}/deactivate`, { method: "PATCH" }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
