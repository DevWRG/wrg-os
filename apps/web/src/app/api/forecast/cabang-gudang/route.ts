import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /forecast/cabang-gudang: peta cabang penjualan (cabang AM saat faktur) → gudang.
export async function GET() {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/forecast/cabang-gudang");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const guard = await requireFeature("/forecast-submission", "edit");
  if (!guard.ok) return guard.res;
  let body: { cabang?: unknown; warehouseKode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/forecast/cabang-gudang", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cabang: body.cabang, warehouseKode: body.warehouseKode ?? null, updatedBy: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
