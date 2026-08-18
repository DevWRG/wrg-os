import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /approval-requests/config/chain (F11).
export async function GET() {
  try {
    const res = await gatewayFetch("/approval-requests/config/chain");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
