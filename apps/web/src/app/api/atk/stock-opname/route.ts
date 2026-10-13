import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F136 ATK Stock Opname — gateway → apps/api /atk/stock-opname. Role min Karyawan.
export async function GET() {
  const guard = await requireFeature("/atk-stock-opname", "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/stock-opname");
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireFeature("/atk-stock-opname", "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/atk/stock-opname", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
