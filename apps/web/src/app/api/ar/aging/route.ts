import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ar/aging?bucket= (read model AR aging).
export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get("bucket");
  const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : "";
  try {
    const res = await gatewayFetch(`/ar/aging${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
