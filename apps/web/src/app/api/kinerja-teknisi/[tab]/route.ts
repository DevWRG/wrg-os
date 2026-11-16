import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /kinerja-teknisi/{teknisi|jadwal|kerja} (menu Kinerja Teknisi, Aftersales).
// Gerbang menu di sini; CAKUPAN teknisi (semua vs diri sendiri) ditegakkan apps/api dari x-user-id —
// gatewayFetch mem-bypass JWT, jadi x-user-id selalu dari sesi, tak pernah dari klien.
const TAB = new Set(["teknisi", "jadwal", "kerja"]);
const QUERY = ["teknisi", "dari", "sampai"] as const;

export async function GET(req: Request, ctx: { params: Promise<{ tab: string }> }) {
  const guard = await requireFeature("/kinerja-teknisi", "view");
  if (!guard.ok) return guard.res;
  const { tab } = await ctx.params;
  if (!TAB.has(tab)) return Response.json({ error: "tab tidak dikenal" }, { status: 404 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of QUERY) {
    const v = src.get(k);
    if (v) qs.set(k, v.slice(0, 64));
  }
  const path = `/kinerja-teknisi/${tab}${qs.toString() ? `?${qs.toString()}` : ""}`;
  try {
    return relay(await gatewayFetch(path, { headers: { "x-user-id": guard.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
