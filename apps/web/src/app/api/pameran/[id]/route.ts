import { idAman, teruskan, type Ctx } from "../_gerbang";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(req, `/pameran/${id}`, "PATCH", "edit");
}
