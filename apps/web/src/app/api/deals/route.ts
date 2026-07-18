import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /deals (buat deal baru). x-user-id → backend set am_id
// (AM → dirinya) + write-guard.
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.text();
  try {
    const res = await gatewayFetch(`/deals`, {
      method: "POST",
      headers: { "x-user-id": me.id, "content-type": "application/json" },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
