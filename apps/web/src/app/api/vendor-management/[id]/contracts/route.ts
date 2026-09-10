import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/vendor-management/${encodeURIComponent(id)}/contracts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
