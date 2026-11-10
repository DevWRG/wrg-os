import { actorName, requireFeature } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /hitl/resolve (approve/reject match ambiguous).
export async function POST(req: Request) {
  const g = await requireFeature("/hitl", "edit");
  if (!g.ok) return g.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/hitl/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Pelaku dari SESI, bukan dari body browser (gerbang tulis BFF): approver_id tercatat di
      // hitl_queue & riwayat deal (Tautkan F9).
      body: JSON.stringify({ ...(body && typeof body === "object" ? body : {}), approver_id: actorName(g.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
