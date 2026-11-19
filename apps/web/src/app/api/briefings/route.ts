import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /briefings (briefing eksekutif A10).
export async function GET() {
  const g = await requireFeature("/briefings");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/briefings");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
