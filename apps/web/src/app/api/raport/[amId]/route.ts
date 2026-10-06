import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

// Raport 1 karyawan (drilldown). Gerbang = halaman /karyawan/[amId]
// (canViewRaportList, matriks Akses Grup menang). apps/api juga menegakkan scope.
export async function GET(req: Request, ctx: { params: Promise<{ amId: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewRaportList(me)) return Response.json({ error: "forbidden (Akses Grup karyawan)" }, { status: 403 });
  const { amId } = await ctx.params;
  const period = new URL(req.url).searchParams.get("period");
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  try {
    return relay(await gatewayFetch(`/raport/${encodeURIComponent(amId)}${qs}`, { headers: { "x-user-id": me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
