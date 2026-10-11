import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /installations (dipakai client-side, mis. sheet
// jadwal install F8 utk pilih alat yg belum BAST).
export async function GET(req: Request) {
  const guard = await requireFeature("/installations", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/installations${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Gateway → apps/api POST /installations (buat unit instalasi baru, F22).
export async function POST(req: Request) {
  const guard = await requireFeature("/installations", "create");
  if (!guard.ok) return guard.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/installations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Pembuat = akun login, bukan isian body (dulu bisa "Direktur Gilang").
      body: JSON.stringify({ ...(body as Record<string, unknown>), created_by: actorName(guard.me) }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
