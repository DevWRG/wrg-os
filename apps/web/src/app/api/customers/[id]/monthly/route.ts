import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /customers/:id/monthly (revenue per bulan satu customer).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const months = new URL(req.url).searchParams.get("months") ?? "12";
  const g = await requireFeature("/customers");
  if (!g.ok) return g.res;
  const me = g.me;
  try {
    const res = await gatewayFetch(`/customers/${encodeURIComponent(id)}/monthly?months=${encodeURIComponent(months)}`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
