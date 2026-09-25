import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";

export const dynamic = "force-dynamic";

// F41 — gate identitas DI SINI (layer WEB, pola CLAUDE.md "Admin-gate di
// layer WEB, bukan di api"): Direktur/HoD/admin saja, konsisten dgn gate
// halaman (purchase-forecast-access.ts).
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPurchaseForecast(me)) return Response.json({ error: "forbidden (Direktur/HoD/admin only)" }, { status: 403 });

  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/purchase-forecast${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPurchaseForecast(me)) return Response.json({ error: "forbidden (Direktur/HoD/admin only)" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/purchase-forecast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, created_by: me.email }),
    });
    return relay(res);
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
