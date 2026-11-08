import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Pratinjau teks alarm + rekap mingguan (dry-run, tanpa WA) — butuh izin UBAH menu.
export async function GET() {
  const g = await requireFeature("/penerbitan-faktur", "edit");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch("/fakturis-diam/pratinjau")); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
