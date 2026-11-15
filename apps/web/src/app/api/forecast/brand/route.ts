import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /forecast/brand: pilihan filter brand (barang ber-buffer / ber-ED / pernah diusulkan).
export async function GET() {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/forecast/brand");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
