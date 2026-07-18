import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH/DELETE /deals/:id. x-user-id → backend write-guard
// (PATCH: AM deal sendiri/HoD cabang/admin; DELETE: admin only).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  try {
    const res = await gatewayFetch(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "x-user-id": me.id, "content-type": "application/json" },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const res = await gatewayFetch(`/deals/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-user-id": me.id },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
