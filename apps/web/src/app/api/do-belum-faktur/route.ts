import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F149 DO belum difaktur — baca saja. gatewayFetch menyuntik service token yang
// mem-bypass JWT di apps/api, jadi izin menu WAJIB dicek di sini.
const KUNCI = ["tab", "q", "cabang", "hanya_terlambat", "limit", "offset"] as const;

export async function GET(req: Request) {
  const g = await requireFeature("/do-belum-faktur", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of KUNCI) { const v = src.get(k); if (v) qs.set(k, v); }
  try { return relay(await gatewayFetch(`/do-belum-faktur${qs.size ? `?${qs}` : ""}`)); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
