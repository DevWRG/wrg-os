import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/vendors (dipakai autocomplete nama vendor
// di form client, mis. Tambah PO F13).
export async function GET() {
  const res = await gatewayFetch(`/accurate/vendors?limit=2000`);
  return relay(res);
}
