import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Tutup manual tiket revisi (mis. “tidak perlu revisi”) — butuh izin UBAH; `oleh` dari sesi.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/penerbitan-faktur", "edit");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "id tidak sah" }, { status: 400 });
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch(`/faktur-revisi/${id}/tutup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ catatan: b.catatan, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
