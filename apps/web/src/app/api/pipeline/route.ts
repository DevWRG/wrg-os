import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /pipeline (deal pipeline read model). Meneruskan identitas
// user via header x-user-id agar backend menerapkan row-level scope (AM → deal
// sendiri, HoD → cabang, admin → semua). resolveScope di backend yg memfilter.
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await gatewayFetch(`/pipeline`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
