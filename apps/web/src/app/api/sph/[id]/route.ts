import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sph/:id (detail SPH + line items).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/sph/${encodeURIComponent(id)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
