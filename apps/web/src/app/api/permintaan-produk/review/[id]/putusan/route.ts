import { idAman, teruskan } from "../../../_gerbang";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  return teruskan(req, `/permintaan-produk/review/${id}/putusan`, "POST", "putusan");
}
