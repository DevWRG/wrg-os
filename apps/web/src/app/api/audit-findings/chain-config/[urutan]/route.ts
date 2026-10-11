import { gatewayFetch, relay } from "@/lib/gateway";
import { requireDirekturOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ urutan: string }> }) {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;
  const { urutan } = await ctx.params;
  let body: { accessGroupId?: number | null; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  return relay(
    await gatewayFetch(`/audit-findings/chain-config/${encodeURIComponent(urutan)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
