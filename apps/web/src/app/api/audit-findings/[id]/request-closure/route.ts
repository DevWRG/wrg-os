import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditAuditFinding } from "@/lib/audit-finding-access";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditAuditFinding(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  return relay(
    await gatewayFetch(`/audit-findings/${encodeURIComponent(id)}/request-closure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requested_by: me.id }),
    }),
  );
}
