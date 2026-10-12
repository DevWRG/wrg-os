import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /shipment-tracking (F12, SHIPPING). Baca-saja: sejak
// 13 Okt 2026 data hanya dari WA #KIRIM/#TERIMA/#BAST/#BUKTI + DO Accurate.
export async function GET(req: Request) {
  const guard = await requireFeature("/shipment-tracking", "view");
  if (!guard.ok) return guard.res;
  const url = new URL(req.url);
  const qs = url.search;
  try {
    const res = await gatewayFetch(`/shipment-tracking${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
