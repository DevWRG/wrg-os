import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F13 (migrasi 205) — PO Tracker = cermin Accurate.
// GET  = status sinkron terakhir (dipakai tombol untuk menunggu selesai).
// POST = picu sinkron (jalan di latar; sinkron pertama beberapa menit).
export async function GET() {
  const guard = await requireFeature("/purchase-orders", "view");
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/purchase-orders/sync-status"));
}

export async function POST() {
  const guard = await requireFeature("/purchase-orders", "edit");
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/accurate/sync/purchase-orders", { method: "POST" }));
}
