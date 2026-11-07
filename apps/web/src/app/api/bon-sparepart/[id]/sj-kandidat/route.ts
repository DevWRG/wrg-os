import { idAman, teruskan } from "../../_gerbang";

export const dynamic = "force-dynamic";

// SJ Accurate yang cocok dengan bon (untuk dipilih manual).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(null, `/bon-sparepart/${id}/sj-kandidat`, "GET");
}
