import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const res = await gatewayFetch("/admin/access/groups");
  return Response.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch("/admin/access/groups", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return Response.json(await res.json(), { status: res.status });
}
