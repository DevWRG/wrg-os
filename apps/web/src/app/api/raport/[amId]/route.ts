import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Raport 1 karyawan (drilldown) — HANYA admin/HoD. apps/api juga menegakkan scope.
export async function GET(req: Request, ctx: { params: Promise<{ amId: string }> }) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const { amId } = await ctx.params;
  const period = new URL(req.url).searchParams.get("period");
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  try {
    return relay(await gatewayFetch(`/raport/${encodeURIComponent(amId)}${qs}`, { headers: { "x-user-id": guard.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
