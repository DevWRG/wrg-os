import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /approval-requests/:id/notify (F11 retry-notify).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/approval-requests", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/approval-requests/${encodeURIComponent(id)}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
