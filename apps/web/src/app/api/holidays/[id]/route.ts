import { requireFeature } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api DELETE /holidays/:id.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/holidays", "delete");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  try {
    const res = await gatewayFetch(`/holidays/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
