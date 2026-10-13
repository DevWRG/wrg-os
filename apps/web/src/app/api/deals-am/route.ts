import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Kandidat AM untuk penunjukan di form deal (HoD = AM cabang timnya; AM = kosong).
// Deal dari #LEADS WA yang kotanya tak terpetakan masuk tanpa AM — HoD/admin
// menunjuknya dari form Edit Deal.
export async function GET() {
  const g = await requireFeature("/pipeline", "view");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch(`/deals-am`, { headers: { "x-user-id": g.me.id } });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
