import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F32 — unduh/lihat satu bukti. Respons BINER — jangan lewat relay() saat sukses.
// Izin dicek di sini: berkasnya sengaja tidak bisa dijangkau lewat /api/media.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/bukti-pembayaran", "view");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/bukti-pembayaran/${id}/file`);
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
