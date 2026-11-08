import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Pratinjau pengingat jatuh tempo H-3/H (dry-run, tanpa WA, tanpa cair otomatis).
export async function GET() {
  const g = await requireFeature("/register-cek", "view");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch("/cek-keluar/pengingat-pratinjau")); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
