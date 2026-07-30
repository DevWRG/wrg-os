import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// F135 ATK Stock Movement — gateway → apps/api /atk/stock-movements. Role min Karyawan.
export async function GET() {
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
  const res = await gatewayFetch("/atk/stock-movements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
