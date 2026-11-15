import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /forecast/wilayah-cabang: pemetaan gudang cabang → wilayah approval (East/West).
export async function GET() {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  try {
    const res = await gatewayFetch("/forecast/wilayah-cabang");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const guard = await requireFeature("/forecast-submission", "edit");
  if (!guard.ok) return guard.res;
  let body: { kode?: unknown; wilayah?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/forecast/wilayah-cabang", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kode: body.kode, wilayah: body.wilayah ?? null }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
