import { info } from "../_publik";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return info((await ctx.params).slug);
}
