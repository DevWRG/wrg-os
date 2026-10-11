import { gatewayFetch, relay } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /lpse-tender/* (F20). Tak ada gate role khusus (pola
// sama ga-helpdesk) — GET boleh anonim, mutasi (POST) butuh sesi login,
// x-user-id diteruskan buat created_by/changed_by_user_id.
export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const qs = new URL(req.url).searchParams.toString();
  const me = await sessionUser();
  try {
    return relay(
      await gatewayFetch(`/lpse-tender${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`, me ? { headers: { "x-user-id": me.id } } : undefined),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/lpse-tender${sub ? `/${sub}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/lpse-tender${sub ? `/${sub}` : ""}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
