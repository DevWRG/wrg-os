import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F61 Tutup Buku — ringkasan (izin lihat menu DO Belum Difaktur; datanya sama).
export async function GET() {
  const g = await requireFeature("/do-belum-faktur", "view");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch("/tutup-buku")); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
