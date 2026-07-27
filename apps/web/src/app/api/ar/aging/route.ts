import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ar/aging?bucket= (read model AR aging).
// x-user-id → row-level scope (AM = AR atas namanya, HoD = cabang tim).
export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get("bucket");
  const qs = bucket ? `?bucket=${encodeURIComponent(bucket)}` : "";
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await gatewayFetch(`/ar/aging${qs}`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
