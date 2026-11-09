import { actorName, requireFeature } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ar/collection-drafts/:id/cancel (A3 cycle).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireFeature("/collection-drafts", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* body opsional */
  }
  try {
    const res = await gatewayFetch(`/ar/collection-drafts/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Pelaku dicatat dari sesi, bukan dari body (UI dulu mengirim "web-ui").
      body: JSON.stringify({ ...(body as object), approver_id: actorName(g.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
