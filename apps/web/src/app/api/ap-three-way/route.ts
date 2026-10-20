import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F152 — daftar faktur pembelian + hasil 3-way match. Gerbang menu di sini (gatewayFetch mem-bypass JWT api).
export async function GET(req: Request) {
  const g = await requireFeature("/ap-three-way", "view");
  if (!g.ok) return g.res;
  try {
    return relay(await gatewayFetch(`/ap/three-way${new URL(req.url).search}`, { method: "GET" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
