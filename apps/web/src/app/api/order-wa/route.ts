import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F90 Antrean Order — gerbang menu; isi ber-scope di API lewat x-user-id dari sesi.
export async function GET(req: Request) {
  const g = await requireFeature("/order-wa", "view");
  if (!g.ok) return g.res;
  const st = new URL(req.url).searchParams.get("status");
  const q = st && /^(draft|antrean|diproses|selesai|batal)$/.test(st) ? `?status=${st}` : "";
  try {
    return relay(await gatewayFetch(`/order-wa${q}`, { headers: { "x-user-id": g.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
