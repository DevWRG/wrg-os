import { idAman, teruskan } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Konversi lead → deal Pipeline. Butuh izin edit Leads (bukan izin Pipeline):
// deal-nya dibuat atas nama AM pemilik lead oleh apps/api.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskan(req, `/leads/${id}/konversi`, "POST", "edit");
}
