import { idAman, teruskan, type Ctx } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Ringkasan untuk layar panggung (nama acara, slug untuk QR, jumlah pendaftar live).
export async function GET(_req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(null, `/pameran/${id}/layar`, "GET", "view");
}
