import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { myApprovableFundRequestRoles } from "@/lib/fund-request-access";

export const dynamic = "force-dynamic";

// F138 — enrich dgn my_roles (tier approval yang boleh diputuskan user ini
// utk request ini) supaya FE tahu tombol Approve/Reject mana yang perlu
// dirender tanpa round-trip identitas terpisah (pola sama [id]/route.ts F35).
//
// Pengajuan di mesin F11 (migrasi 248): my_roles diturunkan dari wewenang
// yang dihitung engine untuk akun sesi (tahap current saja), bukan dari
// aturan peran lokal — supaya tombol yang tampil sama dengan yang lolos.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await sessionUser();
  const viewer = me ? `?viewer_user_id=${encodeURIComponent(me.id)}` : "";
  const res = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}${viewer}`);
  if (!res.ok) return relay(res);
  const fr = await res.json();
  const canCancel = !!me && (me.email === fr.requester_email || me.role === "admin" || me.superuser === true);
  const myRoles = fr.approval_request_id
    ? fr.approval?.wewenang?.boleh && fr.approval.current_role
      ? [fr.approval.current_role]
      : []
    : myApprovableFundRequestRoles(me, fr);
  return Response.json({ ...fr, my_roles: myRoles, can_cancel: canCancel }, { status: res.status });
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

  const oleh = encodeURIComponent(me.name ?? me.email);
  const res = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}?oleh=${oleh}`, { method: "DELETE" });
  return relay(res);
}
