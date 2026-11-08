import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /sph (F15 form intake). Gerbang: create menu Sales
// Docs; created_by = pelaku sesi (body diabaikan), x-user-id utk penanda pembuat.
export async function POST(req: Request) {
  const g = await requireFeature("/sales-docs", "create");
  if (!g.ok) return g.res;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/sph", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify(bodyDenganPelaku(body, "created_by", actorName(g.me))),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
