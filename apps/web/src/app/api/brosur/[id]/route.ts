import { idAman, teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(req, `/materi/${id}`, "PATCH", "edit");
}
