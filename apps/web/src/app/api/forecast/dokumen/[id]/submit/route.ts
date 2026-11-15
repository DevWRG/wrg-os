import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/dokumen/:id/submit (F19 → F11). Pengaju dari sesi, bukan body.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/forecast-submission", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/forecast/dokumen/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submittedBy: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
