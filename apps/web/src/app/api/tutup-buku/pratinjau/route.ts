import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Pratinjau pengingat tutup buku (dry-run, tak mengirim). Izin UBAH.
export async function GET(req: Request) {
  const g = await requireFeature("/do-belum-faktur", "edit");
  if (!g.ok) return g.res;
  const sisa = new URL(req.url).searchParams.get("sisa");
  const q = sisa === "7" || sisa === "3" || sisa === "1" ? `?sisa=${sisa}` : "";
  try { return relay(await gatewayFetch(`/tutup-buku/pratinjau${q}`)); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
