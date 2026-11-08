import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bulan: string }> };

// Geser tanggal tutup buku satu bulan (izin UBAH); tanggal kosong = kembali ke hari kerja terakhir.
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await requireFeature("/do-belum-faktur", "edit");
  if (!g.ok) return g.res;
  const bulan = (await ctx.params).bulan;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) return Response.json({ error: "bulan harus YYYY-MM" }, { status: 400 });
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch(`/tutup-buku/${bulan}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tanggal: b.tanggal ?? null, catatan: b.catatan ?? null, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
