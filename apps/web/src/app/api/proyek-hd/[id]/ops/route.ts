import { idAman, teruskanGet } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  return id ? teruskanGet(`/proyek-hd/${id}/ops`) : Response.json({ error: "id tidak valid" }, { status: 400 });
}
