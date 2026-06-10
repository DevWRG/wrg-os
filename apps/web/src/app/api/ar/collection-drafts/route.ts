import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ar/collection-drafts?status= (draft penagihan A3).
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  try {
    const res = await gatewayFetch(`/ar/collection-drafts${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
