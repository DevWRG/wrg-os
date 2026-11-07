import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F96 — retensi & lead source untuk menu /kohort. gatewayFetch mem-bypass JWT di apps/api, jadi
// izin WAJIB dicek di sini. Hanya dua tab yang dikenal; `tahun` divalidasi 4 digit.
const TAB: Record<string, string> = { retensi: "/kohort/retensi", "lead-source": "/kohort/lead-source" };

export async function GET(req: Request, ctx: { params: Promise<{ tab: string }> }) {
  const g = await requireFeature("/kohort", "view");
  if (!g.ok) return g.res;
  const { tab } = await ctx.params;
  const path = TAB[tab];
  if (!path) return Response.json({ error: "tab tak dikenal" }, { status: 404 });
  const tahun = new URL(req.url).searchParams.get("tahun");
  try {
    return relay(await gatewayFetch(`${path}${tahun && /^\d{4}$/.test(tahun) ? `?tahun=${tahun}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
