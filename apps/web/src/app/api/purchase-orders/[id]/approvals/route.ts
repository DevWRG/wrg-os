import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canDecideApprovalRole, type ApproverRole } from "@/lib/po-approval-access";

export const dynamic = "force-dynamic";

// F35 — approve/reject 1 tier approval PO. Gate identitas DI SINI (layer WEB,
// pola CLAUDE.md "Admin-gate di layer WEB, bukan di api") — apps/api hanya
// menegakkan business-rule sequencing (Tier 2 menunggu Tier 1) & idempotensi.
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
  if (role !== "hod_business" && role !== "hod_finance" && role !== "direktur") {
    return Response.json({ error: "role tidak valid (hod_business/hod_finance/direktur)" }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject") {
    return Response.json({ error: "decision wajib (approve/reject)" }, { status: 400 });
  }

  const poRes = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}`);
  if (!poRes.ok) return relay(poRes);
  const po = await poRes.json();

  if (!canDecideApprovalRole(me, po, role as ApproverRole)) {
    return Response.json({ error: "forbidden — bukan approver yang berwenang utk tier ini" }, { status: 403 });
  }

  const res = await gatewayFetch(`/purchase-orders/${encodeURIComponent(id)}/approvals/${role}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: body.decision, decided_by: me.email, note: body.note ?? undefined }),
  });
  return relay(res);
}
