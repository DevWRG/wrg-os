import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ga-asset-relocations (daftar relokasi aset GA).
export async function GET(req: Request) {
  const guard = await requireFeature("/ga-relokasi", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  try {
    return await relay(await gatewayFetch(`/ga-asset-relocations${qs}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
