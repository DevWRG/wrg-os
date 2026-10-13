import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /ga-ticket-categories/:id (F139).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-helpdesk", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch(`/ga-ticket-categories/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
