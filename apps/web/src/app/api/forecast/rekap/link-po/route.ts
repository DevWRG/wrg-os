import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/rekap/link-po (F153): satu nomor PO Accurate
// untuk semua cabang yang memesan barang itu di bulan itu.
export async function POST(req: Request) {
  const guard = await requireFeature("/forecast-submission", "create");
  if (!guard.ok) return guard.res;
  let body: { bulan?: unknown; itemId?: unknown; poNumber?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/forecast/rekap/link-po", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bulan: body.bulan, itemId: body.itemId, poNumber: body.poNumber }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
