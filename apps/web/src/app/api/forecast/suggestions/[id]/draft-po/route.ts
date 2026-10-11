import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/suggestions/:id/draft-po (F153).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/forecast-submission", "create");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/forecast/suggestions/${encodeURIComponent(id)}/draft-po`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // createdBy = email, selaras created_by PO buatan manual (POST /purchase-orders).
      body: JSON.stringify({ ...(body as Record<string, unknown>), createdBy: guard.me.email }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
