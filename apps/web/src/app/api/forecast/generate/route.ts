import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/generate (F19).
export async function POST() {
  const guard = await requireFeature("/forecast-submission", "create");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/forecast/generate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
