import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Proxy list vendor mirror Accurate (`/accurate/vendors`) — dipakai autocomplete
// nama supplier di form client (F36). Sebelumnya cuma ada detail per-id.
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/accurate/vendors${qs}`);
  return relay(res);
}
