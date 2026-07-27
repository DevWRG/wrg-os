import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /customers?am_id= (read model dari deal).
export async function GET(req: Request) {
  const amId = new URL(req.url).searchParams.get("am_id");
  const qs = amId ? `?am_id=${encodeURIComponent(amId)}` : "";
  const me = await sessionUser();
  try {
    const res = await gatewayFetch(`/customers${qs}`, me ? { headers: { "x-user-id": me.id } } : undefined);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
