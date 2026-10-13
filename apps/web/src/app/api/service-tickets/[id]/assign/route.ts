import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /service-tickets/:id/assign (F26, penugasan manual
// tiket perlu review / ganti teknisi). Pelaku dari sesi, bukan body.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/service-tickets", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  let body: { teknisi_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch(`/service-tickets/${encodeURIComponent(id)}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teknisi_id: typeof body.teknisi_id === "string" ? body.teknisi_id : undefined, by: actorName(guard.me) }),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
