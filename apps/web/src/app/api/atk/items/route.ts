import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F134 ATK Master — gateway → apps/api /atk/items. Role min Karyawan.
export async function GET() {
  const guard = await requireFeature(["/atk-master", "/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"], "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/items");
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireFeature("/atk-master", "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/atk/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
