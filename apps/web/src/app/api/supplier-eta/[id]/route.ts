import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/supplier-eta/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/supplier-eta/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
