import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canDecideFundRequestApprovalRole, type ApproverRole } from "@/lib/fund-request-access";

export const dynamic = "force-dynamic";

// F138 — approve/reject 1 tier (hod/direktur). Gate identitas DI SINI (layer
// WEB, pola CLAUDE.md "Admin-gate di layer WEB, bukan di api") — apps/api
// hanya menegakkan business-rule sequencing (direktur menunggu hod) &
// idempotensi (pola sama approvals/route.ts F35).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: { role?: string; decision?: string; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const role = body.role;
  if (role !== "hod" && role !== "direktur") {
    return Response.json({ error: "role tidak valid (hod/direktur)" }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject") {
    return Response.json({ error: "decision wajib (approve/reject)" }, { status: 400 });
  }

  const frRes = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}`);
  if (!frRes.ok) return relay(frRes);
  const fr = await frRes.json();

  if (!canDecideFundRequestApprovalRole(me, fr, role as ApproverRole)) {
    return Response.json({ error: "forbidden — bukan approver yang berwenang utk tier ini" }, { status: 403 });
  }

  const res = await gatewayFetch(`/fund-requests/${encodeURIComponent(id)}/approvals/${role}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: body.decision, decided_by: me.email, note: body.note ?? undefined }),
  });
  return relay(res);
}
