import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { canViewMargin } from "@/lib/product-scorecard-access";

export const dynamic = "force-dynamic";

// F6 Product Scorecard. Gerbang menu di sini; parameter disaring (whitelist), margin=1
// ditentukan dari JABATAN sesi — tak pernah dari query pengguna.
const PARAM = ["from", "to", "level", "kategori", "lini", "brand"] as const;

export async function GET(req: Request) {
  const g = await requireFeature("/product-scorecard", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const q = new URLSearchParams();
  for (const k of PARAM) {
    const v = src.get(k);
    if (v) q.set(k, v.slice(0, 120));
  }
  if (canViewMargin(g.me)) q.set("margin", "1");
  try {
    return relay(await gatewayFetch(`/product-scorecard?${q.toString()}`, { headers: { "x-user-id": g.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
