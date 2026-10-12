import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/suggestions/:id/link-po (F153). Usulan yang
// sudah approved ditautkan ke PO Accurate (PO Tracker = cermin Accurate, 205).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/forecast-submission", "create");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  let body: { poNumber?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/forecast/suggestions/${encodeURIComponent(id)}/link-po`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poNumber: typeof body.poNumber === "string" ? body.poNumber : "" }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
