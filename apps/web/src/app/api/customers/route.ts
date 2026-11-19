import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /customers?am_id= (read model dari deal).
export async function GET(req: Request) {
  const amId = new URL(req.url).searchParams.get("am_id");
  const qs = amId ? `?am_id=${encodeURIComponent(amId)}` : "";
  const g = await requireFeature("/customers");
  if (!g.ok) return g.res;
  const me = g.me;
  try {
    const res = await gatewayFetch(`/customers${qs}`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
