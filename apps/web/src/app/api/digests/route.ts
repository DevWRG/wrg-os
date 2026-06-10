import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /digests?limit= (riwayat rekap/resume).
export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get("limit") ?? "20";
  try {
    const res = await gatewayFetch(`/digests?limit=${encodeURIComponent(limit)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
