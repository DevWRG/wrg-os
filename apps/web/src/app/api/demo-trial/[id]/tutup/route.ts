import { idAman, teruskan } from "../../_gerbang";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(req, `/demo-trial/${id}/tutup`, "POST", "edit");
}
