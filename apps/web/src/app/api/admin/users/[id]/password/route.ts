import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/admin/users/${encodeURIComponent(id)}/password`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return Response.json(await res.json(), { status: res.status });
}
