import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; srcId: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id, srcId } = await ctx.params;
  const res = await gatewayFetch(
    `/admin/access/groups/${encodeURIComponent(id)}/copy-from/${encodeURIComponent(srcId)}`,
    { method: "POST" },
  );
  return Response.json(await res.json(), { status: res.status });
}
