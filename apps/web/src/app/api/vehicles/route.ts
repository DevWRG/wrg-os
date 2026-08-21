import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /vehicles (F50, OPS).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/vehicles${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
