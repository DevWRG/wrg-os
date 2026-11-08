import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Beri / hapus nama akun fakturis Accurate — butuh izin UBAH menu; `oleh` dari sesi.
export async function PUT(req: Request) {
  const g = await requireFeature("/penerbitan-faktur", "edit");
  if (!g.ok) return g.res;
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch("/fakturis-diam/akun", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ created_by: b.created_by, label: b.label, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
