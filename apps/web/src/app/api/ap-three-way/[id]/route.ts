import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/ap-three-way", "view");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    return relay(await gatewayFetch(`/ap/three-way/${id}`, { method: "GET" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
