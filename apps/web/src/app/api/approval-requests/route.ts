import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /approval-requests (F11).
export async function GET(req: Request) {
  const guard = await requireFeature("/approval-requests", "view");
  if (!guard.ok) return guard.res;
  const status = new URL(req.url).searchParams.get("status");
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  try {
    const res = await gatewayFetch(`/approval-requests${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const guard = await requireFeature("/approval-requests", "create");
  if (!guard.ok) return guard.res;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/approval-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Pengaju = akun login, bukan isian form (dulu bisa "atas nama Direktur").
      // requestedByWa dibuang dari body; API mengambil nomor WA dari akunnya.
      body: JSON.stringify({
        ...(body as Record<string, unknown>),
        requestedBy: actorName(guard.me),
        requestedByUserId: guard.me.id,
        requestedByWa: undefined,
      }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
