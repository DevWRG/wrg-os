import { daftar } from "../../_publik";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return daftar(req, (await ctx.params).slug);
}
