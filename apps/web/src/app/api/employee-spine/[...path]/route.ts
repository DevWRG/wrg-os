import { gatewayFetch } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { sessionUser, requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /employee-spine/*.
//  - GET: read-only (open, di balik auth gate middleware).
//  - POST .../measurements: butuh sesi login (isi scorecard KPI).
//  - POST/PATCH/DELETE employees (CRUD core): butuh ADMIN.
async function forward(sub: string, method: string, req?: Request): Promise<Response> {
  try {
    const body = req ? await req.text() : undefined;
    const res = await gatewayFetch(`/employee-spine/${sub}`, {
      method,
      headers: body != null ? { "content-type": "application/json" } : undefined,
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = safeSubpath(path);
  if (sub === null) return badSubpath();
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  try {
    const res = await gatewayFetch(`/employee-spine/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  if (sub.endsWith("/measurements")) {
    const me = await sessionUser();
    if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  } else {
    const g = await requireAdmin();
    if (!g.ok) return g.res;
  }
  return forward(sub, "POST", req);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  return forward(sub, "PATCH", req);
}

export async function PUT(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  return forward(sub, "PUT", req);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  return forward(sub, "DELETE");
}
