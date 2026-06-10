import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /agents/a12/run (A12 People Analytics).
export async function POST() {
  try {
    const res = await gatewayFetch("/agents/a12/run", { method: "POST" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
