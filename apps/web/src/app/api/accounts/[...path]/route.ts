import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /accounts/* (F62). GET di balik auth middleware; mutasi
// (account fields + contact CRUD) butuh sesi login. x-user-id selalu diteruskan
// → backend menerapkan row-level scope by pemilik akun (crm_account.owner_am_id)
// sekaligus write-guard (AM tak boleh memindah kepemilikan).
async function forward(sub: string, method: string, userId: string, req?: Request): Promise<Response> {
  try {
    const body = req ? await req.text() : undefined;
    const res = await gatewayFetch(`/accounts/${sub}`, {
      method,
      headers: body != null ? { "content-type": "application/json", "x-user-id": userId } : { "x-user-id": userId },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = ((await ctx.params).path ?? []).join("/");
  const qs = new URL(req.url).searchParams.toString();
  const me = await sessionUser();
  try {
    const res = await gatewayFetch(`/accounts/${sub}${qs ? `?${qs}` : ""}`, me ? { headers: { "x-user-id": me.id } } : undefined);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

async function guarded(method: string, req: Request | undefined, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return forward(((await ctx.params).path ?? []).join("/"), method, me.id, req);
}
export const POST = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => guarded("POST", req, ctx);
export const PATCH = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => guarded("PATCH", req, ctx);
export const DELETE = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => guarded("DELETE", undefined, ctx);
