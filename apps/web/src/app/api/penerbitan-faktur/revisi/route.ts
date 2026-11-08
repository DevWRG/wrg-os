import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F10 Faktur Revisi — baca saja. Izin menu Penerbitan Faktur dicek di sini (service token mem-bypass JWT).
export async function GET(req: Request) {
  const g = await requireFeature("/penerbitan-faktur", "view");
  if (!g.ok) return g.res;
  const hari = new URL(req.url).searchParams.get("hari");
  const qs = hari && /^\d{1,3}$/.test(hari) ? `?hari=${hari}` : "";
  try { return relay(await gatewayFetch(`/faktur-revisi${qs}`)); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
