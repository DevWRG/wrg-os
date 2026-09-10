import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/generate (F19).
export async function POST() {
  try {
    const res = await gatewayFetch("/forecast/generate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
