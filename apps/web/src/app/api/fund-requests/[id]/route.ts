import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { myApprovableFundRequestRoles } from "@/lib/fund-request-access";

export const dynamic = "force-dynamic";

// F138 — enrich dgn my_roles (tier approval yang boleh diputuskan user ini
// utk request ini) supaya FE tahu tombol Approve/Reject mana yang perlu
// dirender tanpa round-trip identitas terpisah (pola sama [id]/route.ts F35).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}`);
  if (!res.ok) return relay(res);
  const fr = await res.json();
  const me = await sessionUser();
  const canCancel = !!me && (me.email === fr.requester_email || me.role === "admin" || me.superuser === true);
  return Response.json({ ...fr, my_roles: myApprovableFundRequestRoles(me, fr), can_cancel: canCancel }, { status: res.status });
}

// Cancel — hanya pengaju sendiri atau admin/superuser (business-rule "belum
// ada keputusan" ditegakkan di apps/api, bukan di sini).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const frRes = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}`);
  if (!frRes.ok) return relay(frRes);
  const fr = await frRes.json();
  const isOwner = me.email === fr.requester_email;
  if (!isOwner && me.role !== "admin" && me.superuser !== true) {
    return Response.json({ error: "forbidden — bukan pengaju request ini" }, { status: 403 });
  }

  const res = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
