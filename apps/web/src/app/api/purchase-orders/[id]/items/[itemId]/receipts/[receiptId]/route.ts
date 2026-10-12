import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; itemId: string; receiptId: string }> }) {
  const guard = await requireFeature("/purchase-orders", "edit");
  if (!guard.ok) return guard.res;
  const { id, itemId, receiptId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(
    `/purchase-orders/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/receipts/${encodeURIComponent(receiptId)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; itemId: string; receiptId: string }> }) {
  const guard = await requireFeature("/purchase-orders", "edit");
  if (!guard.ok) return guard.res;
  const { id, itemId, receiptId } = await ctx.params;
  const res = await gatewayFetch(
    `/purchase-orders/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/receipts/${encodeURIComponent(receiptId)}`,
    { method: "DELETE" },
  );
  return relay(res);
}
