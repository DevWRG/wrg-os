import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /dashboard/overview (Sales Overview gabungan).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  try {
    const res = await gatewayFetch(`/dashboard/overview${qs.toString() ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
