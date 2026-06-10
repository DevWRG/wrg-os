import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /hitl?status= (antrian konfirmasi HITL).
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "pending";
  try {
    const res = await gatewayFetch(`/hitl?status=${encodeURIComponent(status)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
