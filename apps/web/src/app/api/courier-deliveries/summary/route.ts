import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/courier-deliveries/summary${qs}`);
  return relay(res);
}
