import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const res = await gatewayFetch("/admin/access/features");
  return Response.json(await res.json(), { status: res.status });
}
