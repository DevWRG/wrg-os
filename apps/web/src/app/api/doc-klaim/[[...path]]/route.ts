import { gatewayFetch, relay } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /doc-klaim/* (DOC #KLAIM). Ingestion normalnya dari WA,
// POST/DELETE di sini buat input manual+hapus data uji tanpa psql langsung.
// GET (list/detail), PATCH (kategori), POST (create/decide/bayar), DELETE.
// Tak ada gate role khusus (approval generik, pola sama F20).
export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const guard = await requireFeature("/doc-klaim", "view");
  if (!guard.ok) return guard.res;
  const me = guard.me;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(
      await gatewayFetch(`/doc-klaim${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`, me ? { headers: { "x-user-id": me.id } } : undefined),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const guard = await requireFeature("/doc-klaim", "edit");
  if (!guard.ok) return guard.res;
  const me = guard.me;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/doc-klaim${sub ? `/${sub}` : ""}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const guard = await requireFeature("/doc-klaim", "edit");
  if (!guard.ok) return guard.res;
  const me = guard.me;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/doc-klaim${sub ? `/${sub}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const guard = await requireFeature("/doc-klaim", "delete");
  if (!guard.ok) return guard.res;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  try {
    return relay(await gatewayFetch(`/doc-klaim${sub ? `/${sub}` : ""}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
