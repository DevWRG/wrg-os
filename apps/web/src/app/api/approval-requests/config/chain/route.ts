import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /approval-requests/config/chain (F11).
export async function GET() {
  const guard = await requireFeature("/approval-requests", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/approval-requests/config/chain");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
