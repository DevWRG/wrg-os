import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /deals/:id/loss-approval (putus loss pending). x-user-id
// → backend guard (hanya HoD/admin). Body: { decision: "approved"|"rejected", note? }.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  try {
    const res = await gatewayFetch(`/deals/${encodeURIComponent(id)}/loss-approval`, {
      method: "PATCH",
      headers: { "x-user-id": me.id, "content-type": "application/json" },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
