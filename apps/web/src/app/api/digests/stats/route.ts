import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /digests/stats?days= (infografis: metadata + metrik konten).
export async function GET(req: Request) {
  const g = await requireFeature("/digests");
  if (!g.ok) return g.res;
  const days = new URL(req.url).searchParams.get("days") ?? "30";
  try {
    const res = await gatewayFetch(`/digests/stats?days=${encodeURIComponent(days)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
