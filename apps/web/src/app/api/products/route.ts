import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/items (katalog produk Accurate, mirror).
// Dipakai form Deal (dropdown Produk). Katalog bersama (bukan data ber-scope),
// cukup guard auth.
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    return relay(await gatewayFetch(`/accurate/items?limit=10000`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
