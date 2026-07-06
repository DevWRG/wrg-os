import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sales-analytics/*. Meneruskan identitas user via
// header x-user-id agar backend menerapkan row-level scope (AM → data sendiri).
// path catch-all: mis. /api/sales-analytics/per-am → /sales-analytics/per-am.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { path } = await ctx.params;
  const sub = (path ?? []).join("/");
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  try {
    const res = await gatewayFetch(`/sales-analytics/${sub}${qs ? `?${qs}` : ""}`, {
      headers: { "x-user-id": me.id },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
