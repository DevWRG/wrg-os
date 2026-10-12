import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F43 Kurir/Ekspedisi Performance Dashboard — gateway → apps/api /courier-deliveries.
// Role min Karyawan (semua login boleh mencatat & lihat riwayat pengiriman).
export async function GET(req: Request) {
  const guard = await requireFeature("/courier-performance", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/courier-deliveries${qs}`);
  return relay(res);
}

// created_by diisi dari sesi login (bukan body client) — pola sama requester_name F138.
export async function POST(req: Request) {
  const guard = await requireFeature("/courier-performance", "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/courier-deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, created_by: actorName(guard.me) }),
  });
  return relay(res);
}
