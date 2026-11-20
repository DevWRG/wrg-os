import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewMargin, canViewProductScorecard } from "@/lib/product-scorecard-access";
import { findNavItem, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductScorecardView, type DataScorecard } from "@/components/product-scorecard/scorecard-view";
import { RevenueStreamView, type StreamPayload } from "@/components/revenue-stream/revenue-stream-view";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-\d{2}$/;

// Kinerja Produk (K15, evaluasi menu 19 Nov 2026): Product Scorecard (F6) dan Revenue
// per Lini memakai data yang sama (baris faktur × kategori/lini) dengan drill yang
// mirip — dilebur jadi dua tab. Izin tetap dua key: tab Scorecard = `product-scorecard`
// (induk, canViewProductScorecard), tab Revenue per Lini = `revenue-stream` (entri
// features; /revenue-stream → ?tab=lini). Hanya tab aktif yang mengambil data — data
// Scorecard (termasuk margin) tak pernah diambil untuk pemegang tab lini saja.
export default async function KinerjaProdukPage({ searchParams }: { searchParams: Promise<{ tab?: string; periode?: string }> }) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const fLini = findNavItem("/product-scorecard")?.features?.find((f) => f.key === "revenue-stream");
  const tabs: DefTab[] = [];
  if (canViewProductScorecard(me)) tabs.push({ key: "scorecard", label: "Scorecard Produk" });
  if (fLini && tabVisible(me, fLini)) tabs.push({ key: "lini", label: "Revenue per Lini" });
  const aktif = pilihTab(tabs, sp.tab);

  const header = (
    <PageHeader
      title="Kinerja Produk"
      description="Kinerja produk per kategori → lini → brand → item (revenue, tren, konsentrasi customer, perputaran stok, kompetitor, margin khusus pembaca HPP) dan revenue per lini produk dari baris faktur Accurate."
    />
  );
  if (!aktif) {
    return <>{header}<EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." /></>;
  }

  if (aktif === "lini") {
    // Periode divalidasi SEBELUM masuk query string: nilai sembarang akan diabaikan
    // endpoint dan diam-diam jatuh ke bulan berjalan.
    const now = new Date();
    const bulanIni = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const periode = sp.periode && MONTH.test(sp.periode) ? sp.periode : bulanIni;
    let data: StreamPayload | null = null;
    try {
      const res = await gatewayFetch(`/reports/revenue-by-stream?periode=${periode}`);
      if (res.ok) data = (await res.json()) as StreamPayload;
    } catch { data = null; }
    return <>{header}<PageTabs tabs={tabs} aktif={aktif} /><RevenueStreamView data={data} periode={periode} /></>;
  }

  let data: DataScorecard | null = null;
  try {
    const q = new URLSearchParams({ level: "kategori" });
    if (canViewMargin(me)) q.set("margin", "1");
    const r = await gatewayFetch(`/product-scorecard?${q.toString()}`, { headers: me ? { "x-user-id": me.id } : {} });
    if (r.ok) data = (await r.json()) as DataScorecard;
  } catch { data = null; }
  return <>{header}<PageTabs tabs={tabs} aktif={aktif} /><ProductScorecardView awal={data} /></>;
}
