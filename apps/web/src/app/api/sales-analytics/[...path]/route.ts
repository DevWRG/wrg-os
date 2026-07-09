import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /sales-analytics/*. Meneruskan identitas user via header
// x-user-id agar backend menerapkan row-level scope (AM → data sendiri) dan
// scoping saved-views/alert per user. path catch-all.
async function proxy(req: Request, path: string[], method: string) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = (path ?? []).join("/");
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const headers: Record<string, string> = { "x-user-id": me.id };
  let body: string | undefined;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["content-type"] = "application/json";
    body = await req.text();
  }
  try {
    const res = await gatewayFetch(`/sales-analytics/${sub}${qs ? `?${qs}` : ""}`, { method, headers, body });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "POST");
}
export async function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "PATCH");
}
export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "DELETE");
}
