import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ga-maintenance/:id/start (F137).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/ga-maintenance/${encodeURIComponent(id)}/start`, { method: "POST" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
