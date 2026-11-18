import { actorName, gatewayFetch, gerbang, idAman, putus, relay, slugAman, teruskanJson } from "../../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const tolak = () => Response.json({ error: "alamat tidak valid" }, { status: 400 });

export async function PATCH(req: Request, ctx: Ctx) {
  const p = await ctx.params;
  const slug = slugAman(p.slug);
  const id = idAman(p.id);
  return slug && id ? teruskanJson(req, `/proyek-hd/ops/${slug}/${id}`, "PATCH", "edit") : tolak();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gerbang("delete");
  if (!g.ok) return g.res;
  const p = await ctx.params;
  const slug = slugAman(p.slug);
  const id = idAman(p.id);
  if (!slug || !id) return tolak();
  try {
    return relay(await gatewayFetch(`/proyek-hd/ops/${slug}/${id}?oleh=${encodeURIComponent(actorName(g.me))}`, { method: "DELETE" }));
  } catch { return putus(); }
}
