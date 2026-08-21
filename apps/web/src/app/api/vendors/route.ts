import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/vendors (dipakai autocomplete nama vendor
// di form client, mis. Add Supplier ETA — /suppliers page pakai server fetch langsung).
export async function GET() {
  const res = await gatewayFetch(`/accurate/vendors?limit=2000`);
  return relay(res);
}
