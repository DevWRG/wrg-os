import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /deals/loss-approvals (daftar loss pending yg boleh
// diputus user ini). x-user-id → backend scope (HoD cabang / admin semua / AM kosong).
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await gatewayFetch(`/deals/loss-approvals`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
