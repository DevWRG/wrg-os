import { idAman, teruskan, type Ctx } from "../../../_gerbang";

export const dynamic = "force-dynamic";

// Jadikan deal: izin ubah menu Pameran; AM/cabang deal ditentukan scope di apps/api (x-user-id).
export async function POST(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(req, `/pameran/pengunjung/${id}/deal`, "POST", "edit");
}
