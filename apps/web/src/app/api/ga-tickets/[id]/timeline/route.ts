import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ga-tickets/:id/timeline (F139).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/ga-tickets/${encodeURIComponent(id)}/timeline`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
