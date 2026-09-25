import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPurchaseForecast(me)) return Response.json({ error: "forbidden (Direktur/HoD/admin only)" }, { status: 403 });

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/purchase-forecast/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return relay(res);
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPurchaseForecast(me)) return Response.json({ error: "forbidden (Direktur/HoD/admin only)" }, { status: 403 });

  const { id } = await ctx.params;
  try {
    return relay(await gatewayFetch(`/purchase-forecast/${encodeURIComponent(id)}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
