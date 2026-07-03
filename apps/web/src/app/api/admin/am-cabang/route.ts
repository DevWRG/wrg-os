import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// AM → Cabang mapping (admin). Proxy → apps/api /admin/am-cabang.
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/admin/am-cabang");
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
    const res = await gatewayFetch("/admin/am-cabang", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
