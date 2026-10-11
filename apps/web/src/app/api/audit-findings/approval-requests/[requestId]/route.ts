import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewAuditFindings } from "@/lib/audit-finding-access";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewAuditFindings(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { requestId } = await ctx.params;
  return relay(await gatewayFetch(`/audit-findings/approval-requests/${encodeURIComponent(requestId)}`));
}
