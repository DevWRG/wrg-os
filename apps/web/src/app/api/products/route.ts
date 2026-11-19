import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/items (katalog produk Accurate, mirror).
// Dipakai form Deal (dropdown Produk). Katalog bersama (bukan data ber-scope),
// tapi tetap ikut izin menu: pemegang Pipeline (form Deal) atau Products. JANGAN
// tambah /inventory — halaman Inventory membaca katalog lewat gatewayFetch di
// server, jadi menambahkannya cuma melebarkan akses.
export async function GET() {
  const g = await requireFeature(["/products", "/pipeline"]);
  if (!g.ok) return g.res;
  try {
    return relay(await gatewayFetch(`/accurate/items?limit=10000`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
