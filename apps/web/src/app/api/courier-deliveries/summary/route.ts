import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireFeature("/courier-performance", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/courier-deliveries/summary${qs}`);
  return relay(res);
}
