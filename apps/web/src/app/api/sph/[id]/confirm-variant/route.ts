import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /sph/:id/confirm-variant (F15 HANDOVER §6 gate).
// Gerbang: edit Sales Docs; confirmed_by = sesi; pembuat SPH ditolak di apps/api.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/sph/${encodeURIComponent(id)}/confirm-variant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify(bodyDenganPelaku(body, "confirmed_by", actorName(g.me))),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
