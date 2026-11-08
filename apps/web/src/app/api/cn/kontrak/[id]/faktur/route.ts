import { idAman, teruskan, tolak } from "../../../_gerbang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return tolak(400, "id tidak valid");
  return teruskan(null, `/cn/kontrak/${id}/faktur`, "GET", "view");
}
