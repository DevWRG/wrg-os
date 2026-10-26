import { idAman, teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// Batalkan bon / tautkan SJ manual. `aksi` + `oleh` diteruskan; `oleh` dari sesi.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(req, `/bon-sparepart/${id}`, "PATCH");
}
