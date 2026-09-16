import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params;
  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/receipts`);
  return relay(res);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
