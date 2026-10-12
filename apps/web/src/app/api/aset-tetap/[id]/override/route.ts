import { idAman, teruskanTulis } from "../../_gerbang";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskanTulis(req, `/aset-tetap/${encodeURIComponent(id)}/override`, "PUT");
}
