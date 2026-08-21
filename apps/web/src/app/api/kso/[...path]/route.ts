import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /kso/* (Simulator KSO, migrasi 074).
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewKso(me)) return Response.json({ error: "forbidden" }, { status: 403 });

  const sub = ((await ctx.params).path ?? []).join("/");
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/kso/${sub}${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
