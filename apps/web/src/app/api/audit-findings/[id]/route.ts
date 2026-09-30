import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewAuditFindings, canEditAuditFinding } from "@/lib/audit-finding-access";

export const dynamic = "force-dynamic";

// Enrich dgn canDecideCurrentStep (anggota grup tahap current request aktif,
// atau admin/superuser) supaya FE tahu tombol Approve/Reject perlu dirender
// tanpa round-trip identitas terpisah (pola sama fund-requests/[id]/route.ts).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewAuditFindings(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/audit-findings/${encodeURIComponent(id)}`);
  if (!res.ok) return relay(res);
  const data = await res.json();
  const activeRequest = data.activeRequest as { currentUrutan: number; steps: { urutan: number; accessGroupId: number | null }[] } | null;
  const currentStep = activeRequest?.steps.find((s) => s.urutan === activeRequest.currentUrutan);
  const isAdmin = me.role === "admin" || me.superuser === true;
  const isMember = !!currentStep?.accessGroupId && (me.groups ?? []).some((g) => g.id === currentStep.accessGroupId);
  return Response.json({ ...data, canManage: canEditAuditFinding(me), canDecideCurrentStep: isAdmin || isMember });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditAuditFinding(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  return relay(
    await gatewayFetch(`/audit-findings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
