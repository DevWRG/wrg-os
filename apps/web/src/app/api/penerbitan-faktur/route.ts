import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F10 Penerbitan Faktur — baca saja. gatewayFetch menyuntik service token yang
// mem-bypass JWT di apps/api, jadi izin menu WAJIB dicek di sini.
export async function GET() {
  const g = await requireFeature("/penerbitan-faktur", "view");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch("/fakturis-diam")); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
