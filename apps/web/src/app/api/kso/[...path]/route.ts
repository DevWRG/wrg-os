import { gatewayFetch, relay } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /kso/* (Simulator KSO, migrasi 074).
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewKso(me)) return Response.json({ error: "forbidden" }, { status: 403 });

  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const qs = new URL(req.url).searchParams.toString();
  try {
    // x-user-id dari sesi: F73 /kso/kesehatan ber-scope (AM = miliknya, HoD = timnya);
    // endpoint KSO lain mengabaikannya.
    return relay(await gatewayFetch(`/kso/${sub}${qs ? `?${qs}` : ""}`, { headers: { "x-user-id": me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
