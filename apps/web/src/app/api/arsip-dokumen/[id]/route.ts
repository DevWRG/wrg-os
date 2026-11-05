import { actorName, gatewayFetch, gerbang, idAman, putus, relay, teruskanJson } from "../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskanJson(req, `/arsip-dokumen/${id}`, "PATCH", "edit");
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gerbang("delete");
  if (!g.ok) return g.res;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    return relay(await gatewayFetch(`/arsip-dokumen/${id}?oleh=${encodeURIComponent(actorName(g.me))}`, { method: "DELETE" }));
  } catch { return putus(); }
}
