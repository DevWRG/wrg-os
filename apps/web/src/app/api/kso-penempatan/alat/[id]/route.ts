import { teruskanBaca } from "../../_gerbang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "id tak valid" }, { status: 400 });
  return teruskanBaca(`/kso-penempatan/alat/${id}`);
}
