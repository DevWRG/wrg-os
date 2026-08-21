import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Proxy list vendor mirror Accurate (`/accurate/vendors`) — dipakai autocomplete
// nama vendor/supplier di form client: F39 Supplier ETA dan F36 Inbound
// Receiving membuat file ini masing-masing, isinya digabung di sini.
// Querystring diteruskan apa adanya (kebutuhan F36); bila pemanggil tak
// mengirim `limit`, dipakai 2000 supaya pemakai lama (F39) tetap dapat daftar
// penuh, bukan diam-diam kepotong default server.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!url.searchParams.has("limit")) url.searchParams.set("limit", "2000");
  const res = await gatewayFetch(`/accurate/vendors?${url.searchParams.toString()}`);
  return relay(res);
}
