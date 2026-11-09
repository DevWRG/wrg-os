import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api PUT /sph/:id/syarat (F15 — syarat & ketentuan per SPH).
// Gerbang: edit Sales Docs. Status draft/hod_review (terkunci setelah approve)
// ditegakkan apps/api; pelaku dari x-user-id sesi.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(
      await gatewayFetch(`/sph/${encodeURIComponent(id)}/syarat`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": g.me.id },
        body: JSON.stringify(bodyDenganPelaku(body, null, "")),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
