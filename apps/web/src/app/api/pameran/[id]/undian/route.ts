import { idAman, teruskan, type Ctx } from "../../_gerbang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(null, `/pameran/${id}/undian`, "GET", "view");
}
export async function POST(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(req, `/pameran/${id}/undian`, "POST", "edit");
}
