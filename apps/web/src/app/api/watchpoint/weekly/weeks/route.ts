import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /watchpoint/weekly/weeks (daftar minggu yang bisa dibuka).
export async function GET(req: Request) {
  const back = new URL(req.url).searchParams.get("back");
  try {
    return relay(await gatewayFetch(`/watchpoint/weekly/weeks${back ? `?back=${encodeURIComponent(back)}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
