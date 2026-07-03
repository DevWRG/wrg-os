import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// GET target per cabang (read). PUT upsert (admin). Proxy → apps/api /sales/targets/cabang.
export async function GET(req: Request) {
  const year = new URL(req.url).searchParams.get("year") ?? "";
  try {
    const res = await gatewayFetch(`/sales/targets/cabang${year ? `?year=${year}` : ""}`);
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await gatewayFetch("/sales/targets/cabang", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
