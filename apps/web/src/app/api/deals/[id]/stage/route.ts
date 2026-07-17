import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /deals/:id/stage (transisi stage F1-SPT). Meneruskan
// identitas via x-user-id → backend write-guard (AM deal sendiri, HoD cabang,
// admin semua) + gate Closing-Lost (loss_reason) + timeline spt_state_log.
// Body: { to_stage: string, loss_reason?: string, note?: string }.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  try {
    const res = await gatewayFetch(`/deals/${encodeURIComponent(id)}/stage`, {
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
