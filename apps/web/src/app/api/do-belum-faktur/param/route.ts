import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Ubah ambang hari kerja — butuh izin UBAH menu; `oleh` dari sesi.
export async function PATCH(req: Request) {
  const g = await requireFeature("/do-belum-faktur", "edit");
  if (!g.ok) return g.res;
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch("/do-belum-faktur/param", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ambang_hari_kerja: b.ambang_hari_kerja, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
