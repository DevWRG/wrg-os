import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";

export const dynamic = "force-dynamic";

// F41 — gerbang sama dengan /api/purchase-forecast (Direktur/HoD/admin).
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPurchaseForecast(me)) return Response.json({ error: "forbidden (Direktur/HoD/admin only)" }, { status: 403 });
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/purchase-forecast/summary${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
