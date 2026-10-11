import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/inbound-receiving", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/inbound-receiving/${encodeURIComponent(id)}`);
  return relay(res);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/inbound-receiving", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/inbound-receiving/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/inbound-receiving", "delete");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/inbound-receiving/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
