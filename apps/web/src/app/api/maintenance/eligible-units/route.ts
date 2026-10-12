import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /maintenance/eligible-units (F24, sumber dropdown create).
export async function GET() {
  const guard = await requireFeature("/maintenance", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/maintenance/eligible-units");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
