import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /messages/annotations?sentiment= (anotasi A8).
export async function GET(req: Request) {
  const sentiment = new URL(req.url).searchParams.get("sentiment");
  const qs = sentiment ? `?sentiment=${encodeURIComponent(sentiment)}` : "";
  try {
    const res = await gatewayFetch(`/messages/annotations${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
