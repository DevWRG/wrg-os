import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F49 ATK Stock Movement — gateway → apps/api /atk/stock-movements. Role min Karyawan.
export async function GET() {
  const guard = await requireFeature(["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"], "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/stock-movements");
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireFeature(["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"], "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/atk/stock-movements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
