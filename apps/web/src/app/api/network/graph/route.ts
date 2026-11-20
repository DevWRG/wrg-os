import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /network/graph?window_days= (graf relasi A9).
export async function GET(req: Request) {
  const g = await requireFeature("/network");
  if (!g.ok) return g.res;
  const days = new URL(req.url).searchParams.get("window_days");
  const qs = days ? `?window_days=${encodeURIComponent(days)}` : "";
  try {
    const res = await gatewayFetch(`/network/graph${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
