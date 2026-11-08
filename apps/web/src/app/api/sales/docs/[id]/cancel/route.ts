import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /sales/docs/:id/cancel (A6 cycle) — cancel.
// Gerbang: edit menu Sales Docs. approver_id = pelaku sesi (body diabaikan),
// x-user-id diteruskan agar apps/api meresolusi pelaku sendiri.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* body opsional */
  }
  try {
    const res = await gatewayFetch(`/sales/docs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify(bodyDenganPelaku(body, "approver_id", actorName(g.me))),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
