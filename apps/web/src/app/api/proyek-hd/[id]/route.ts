import { idAman, teruskanGet, teruskanJson } from "../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const tolak = () => Response.json({ error: "id tidak valid" }, { status: 400 });

export async function GET(_req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  return id ? teruskanGet(`/proyek-hd/${id}`) : tolak();
}

export async function PATCH(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  return id ? teruskanJson(req, `/proyek-hd/${id}`, "PATCH", "edit") : tolak();
}
