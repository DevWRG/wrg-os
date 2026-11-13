import { gatewayFetch, gerbang, idAman, putus, relay } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Unduh lampiran (dibaca server dari disk unggahan, bukan tautan publik). Respons BINER — jangan lewat relay() kecuali galat.
export async function GET(_req: Request, ctx: Ctx) {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/proyek-hd/lampiran/${id}`);
    if (!res.ok) return relay(res);
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch { return putus(); }
}
