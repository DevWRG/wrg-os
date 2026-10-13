import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F49 ATK Stock Movement — laporan stok saat ini per barang (computed, bukan kolom tersimpan).
export async function GET() {
  const guard = await requireFeature(["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"], "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/atk/stock-levels");
  return relay(res);
}
