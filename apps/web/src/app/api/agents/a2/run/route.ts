import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /agents/a2/run (A2 AR Aging Watch).
export async function POST() {
  try {
    const res = await gatewayFetch("/agents/a2/run", { method: "POST" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
