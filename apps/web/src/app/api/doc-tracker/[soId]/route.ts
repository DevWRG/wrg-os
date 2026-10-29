import { idAman, teruskan, tolak } from "../_gerbang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ soId: string }> }) {
  const id = idAman((await ctx.params).soId);
  if (!id) return tolak(400, "id SO tidak valid");
  return teruskan(null, `/doc-tracker/${id}`, "GET", "view");
}
