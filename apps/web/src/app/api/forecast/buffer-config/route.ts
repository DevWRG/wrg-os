import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /forecast/buffer-config (F19).
export async function GET() {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/forecast/buffer-config");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const guard = await requireFeature("/forecast-submission", "edit");
  if (!guard.ok) return guard.res;
  let body: { itemId?: unknown; warehouseKode?: unknown; bufferPersen?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/forecast/buffer-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Daftar putih + pengubah dari sesi (dulu "web-ui" dari browser).
      body: JSON.stringify({
        itemId: body.itemId,
        warehouseKode: body.warehouseKode,
        bufferPersen: body.bufferPersen,
        updatedBy: actorName(guard.me),
      }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
