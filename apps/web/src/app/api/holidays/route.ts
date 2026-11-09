import { featureAllowed, requireFeature } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /holidays (upsert hari libur).
export async function POST(req: Request) {
  // Upsert per tanggal: bisa menambah ATAU menimpa → wajib izin create dan edit.
  const g = await requireFeature("/holidays", "create");
  if (!g.ok) return g.res;
  if (!featureAllowed(g.me, "/holidays", "edit")) {
    return Response.json({ error: "forbidden — tak punya izin edit untuk menu ini" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/holidays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
