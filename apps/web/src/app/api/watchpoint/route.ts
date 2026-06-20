import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /watchpoint (F76 WatchPoint HoD board).
export async function GET() {
  try {
    const res = await gatewayFetch(`/watchpoint`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
