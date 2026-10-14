import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /pickup-plan (F45 jadwal trip Kirim-Tagih).
export async function GET(req: Request) {
  const guard = await requireFeature("/pickup-plan", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/pickup-plan${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const guard = await requireFeature("/pickup-plan", "create");
  if (!guard.ok) return guard.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/pickup-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Pembuat = akun login, bukan isian body.
      body: JSON.stringify({ ...(body as Record<string, unknown>), created_by: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
