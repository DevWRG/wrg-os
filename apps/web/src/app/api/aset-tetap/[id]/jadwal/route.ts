import { idAman, teruskanGet } from "../../_gerbang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskanGet(`/aset-tetap/${encodeURIComponent(id)}/jadwal`);
}
