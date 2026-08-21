import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { myApprovableRoles } from "@/lib/po-approval-access";

export const dynamic = "force-dynamic";

// F35 — enrich dgn my_roles (tier approval yang boleh diputuskan user ini utk
// PO ini) supaya FE tahu tombol Approve/Reject mana yang perlu dirender tanpa
// round-trip identitas terpisah. relay() sudah mengembalikan Response jadi
// (tak bisa "dienrich"), jadi jalur sukses di-parse manual di sini.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}`);
  if (!res.ok) return relay(res);
  const po = await res.json();
  const me = await sessionUser();
  return Response.json({ ...po, my_roles: myApprovableRoles(me, po) }, { status: res.status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
