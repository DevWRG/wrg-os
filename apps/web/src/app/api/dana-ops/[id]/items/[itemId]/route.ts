import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const { id, itemId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/dana-ops/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const { id, itemId } = await ctx.params;
  const res = await gatewayFetch(`/dana-ops/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  return relay(res);
}
