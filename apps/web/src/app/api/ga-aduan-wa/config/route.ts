import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PUT /ga-aduan-wa/config — nama WA staf GA. updated_by
// dari sesi, bukan dari body.
export async function PUT(req: Request) {
  const guard = await requireFeature("/ga-helpdesk", "edit");
  if (!guard.ok) return guard.res;
  let body: { staf_ga_names?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch("/ga-aduan-wa/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staf_ga_names: body.staf_ga_names, updated_by: actorName(guard.me) }),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
