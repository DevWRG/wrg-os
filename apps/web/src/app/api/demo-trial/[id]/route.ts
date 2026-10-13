import { idAman, teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(null, `/demo-trial/${id}`, "GET", "view");
}
export async function PATCH(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(req, `/demo-trial/${id}`, "PATCH", "edit");
}
