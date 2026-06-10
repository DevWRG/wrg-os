import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /stats?am_id= (KPI dashboard).
export async function GET(req: Request) {
  const amId = new URL(req.url).searchParams.get("am_id");
  const qs = amId ? `?am_id=${encodeURIComponent(amId)}` : "";
  try {
    const res = await gatewayFetch(`/stats${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
