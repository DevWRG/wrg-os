import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import { canEditOrderWa } from "@/lib/order-wa-access";

export const dynamic = "force-dynamic";

// Ubah status pesanan (proses/selesai/batal). Izin edit menu + gate jabatan; `oleh` dari sesi.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/order-wa", "edit");
  if (!g.ok) return g.res;
  if (!canEditOrderWa(g.me)) return Response.json({ error: "forbidden — hanya Admin Sales/admin" }, { status: 403 });
  const id = (await ctx.params).id;
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "id tidak valid" }, { status: 400 });
  let isi: Record<string, unknown> = {};
  try { const t = await req.text(); isi = t ? (JSON.parse(t) as Record<string, unknown>) : {}; } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  const body = JSON.stringify({ status: isi.status, so_number: isi.so_number, alasan: isi.alasan, catatan: isi.catatan, oleh: actorName(g.me) });
  try {
    return relay(await gatewayFetch(`/order-wa/${id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-user-id": g.me.id }, body }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
