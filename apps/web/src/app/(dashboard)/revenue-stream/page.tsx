import { redirect } from "next/navigation";

// Revenue per Lini kini tab di menu Kinerja Produk (K15, evaluasi menu 19 Nov 2026).
// Rute lama dipertahankan sebagai redirect (periode ikut) supaya tautan yang sudah
// beredar — termasuk dari kartu WatchPoint/metric `revstream` — tidak 404. Path ini
// tetap dimiliki entri features `revenue-stream` (findNavItem).
export default async function RevenueStreamRedirect({ searchParams }: { searchParams: Promise<{ periode?: string }> }): Promise<never> {
  const { periode } = await searchParams;
  redirect(`/product-scorecard?tab=lini${periode ? `&periode=${encodeURIComponent(periode)}` : ""}`);
}
