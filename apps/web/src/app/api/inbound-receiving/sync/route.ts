import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F36 (migrasi 206) — Inbound = cermin Penerimaan Barang Accurate.
// GET  = status sinkron terakhir (dipakai tombol untuk menunggu selesai).
// POST = picu sinkron receive-item (jalan di latar).
export async function GET() {
  const guard = await requireFeature("/inbound-receiving", "view");
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/inbound-receiving/sync-status"));
}

export async function POST() {
  const guard = await requireFeature("/inbound-receiving", "edit");
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/accurate/sync/receive-items", { method: "POST" }));
}
