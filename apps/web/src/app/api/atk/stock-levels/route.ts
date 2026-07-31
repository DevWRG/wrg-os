import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// F49 ATK Stock Movement — laporan stok saat ini per barang (computed, bukan kolom tersimpan).
export async function GET() {
  const res = await gatewayFetch("/atk/stock-levels");
  return relay(res);
}
