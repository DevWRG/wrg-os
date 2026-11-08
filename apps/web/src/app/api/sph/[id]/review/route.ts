import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /sph/:id/review (F15 tahap 1/2: HOD Business review).
// Gerbang menu (view Sales Docs) di sini; syarat HoD Business aktif / admin +
// bukan pembuat SPH ditegakkan apps/api dari x-user-id. reviewer_id = sesi.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* body opsional */
  }
  try {
    const res = await gatewayFetch(`/sph/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify(bodyDenganPelaku(body, "reviewer_id", actorName(g.me))),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
