import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /executive/* (F76 Director Dashboard). Teruskan identitas
// user via x-user-id agar AM RADAR ter-scope (AM → data sendiri, HoD → cabang).
async function proxy(req: Request, path: string[], method: string) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = (path ?? []).join("/");
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const headers: Record<string, string> = { "x-user-id": me.id };
  try {
    const res = await gatewayFetch(`/executive/${sub}${qs ? `?${qs}` : ""}`, { method, headers });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}
