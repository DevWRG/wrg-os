import { idAman, teruskanMultipart } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  return teruskanMultipart(req, `/proyek-hd/${id}/catatan`, ["tahap_kode", "tanggal", "catatan"]);
}
