import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ga-aduan-wa (pengaturan + statistik pemindai grup WA Aduan GA).
export async function GET() {
  const guard = await requireFeature("/ga-helpdesk", "view");
  if (!guard.ok) return guard.res;
  try {
    return await relay(await gatewayFetch("/ga-aduan-wa"));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
