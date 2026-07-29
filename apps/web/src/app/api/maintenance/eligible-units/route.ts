import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /maintenance/eligible-units (F24, sumber dropdown create).
export async function GET() {
  try {
    const res = await gatewayFetch("/maintenance/eligible-units");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
