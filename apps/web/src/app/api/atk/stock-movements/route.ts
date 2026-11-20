import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { atkCreateMenus, MENU_ATK } from "@/lib/atk-access";

export const dynamic = "force-dynamic";

// F49 ATK Stock Movement — gateway → apps/api /atk/stock-movements. Izin tulis
// per jenis gerakan (lib/atk-access): masuk ≠ keluar.
export async function GET() {
  const guard = await requireFeature(MENU_ATK, "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/stock-movements");
  return relay(res);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const menus = atkCreateMenus(body.movement_type);
  if (!menus) return Response.json({ error: "movement_type harus 'in' atau 'out'" }, { status: 400 });
  const guard = await requireFeature(menus, "create");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/stock-movements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
