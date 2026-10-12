import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/courier-performance", "view");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const res = await gatewayFetch(`/courier-deliveries/${encodeURIComponent(id)}`);
  return relay(res);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/courier-performance", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch(`/courier-deliveries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/courier-performance", "delete");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const res = await gatewayFetch(`/courier-deliveries/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
