import { gatewayFetch, relay } from "@/lib/gateway";

import { gerbang, idAman } from "../../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; dokId: string }> };

// Unduh dokumen kontrak. Respons BINER — jangan lewat relay(). Izin dicek di
// sini: berkasnya sengaja tidak bisa dijangkau lewat /api/media.
export async function GET(_req: Request, ctx: Ctx) {
  const g = await gerbang("view");
  if ("tolak" in g) return g.tolak;
  const p = await ctx.params;
  const id = idAman(p.id);
  const dok = idAman(p.dokId);
  if (!id || !dok) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/kso-kontrak/${id}/dokumen/${dok}`);
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
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gerbang("edit");
  if ("tolak" in g) return g.tolak;
  const p = await ctx.params;
  const id = idAman(p.id);
  const dok = idAman(p.dokId);
  if (!id || !dok) return Response.json({ error: "id tidak valid" }, { status: 400 });
  const oleh = encodeURIComponent(g.me.name?.trim() || g.me.email || g.me.id);
  try {
    return relay(await gatewayFetch(`/kso-kontrak/${id}/dokumen/${dok}?oleh=${oleh}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
