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
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Rentang tab Revenue per Lini: ?from=&to= (kontrol bersama RentangPeriode); ?periode=YYYY-MM
// lama (tautan dari /revenue-stream) tetap dihormati; default = bulan berjalan (WIB).
function rentangLini(sp: { periode?: string; from?: string; to?: string }): { from: string; to: string } {
  if (sp.from && sp.to && ISO.test(sp.from) && ISO.test(sp.to) && sp.from <= sp.to) return { from: sp.from, to: sp.to };
  const now = new Date(Date.now() + 7 * 3600_000);
  const bulan = sp.periode && MONTH.test(sp.periode) ? sp.periode : now.toISOString().slice(0, 7);
  const [y, m] = bulan.split("-").map(Number);
  const akhirBulan = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const hariIni = now.toISOString().slice(0, 10);
  return { from: `${bulan}-01`, to: akhirBulan < hariIni ? akhirBulan : hariIni };
}

// Kinerja Produk (K15, evaluasi menu 19 Nov 2026): Product Scorecard (F6) dan Revenue
// per Lini memakai data yang sama (baris faktur × kategori/lini) dengan drill yang
// mirip — dilebur jadi dua tab. Izin tetap dua key: tab Scorecard = `product-scorecard`
// (induk, canViewProductScorecard), tab Revenue per Lini = `revenue-stream` (entri
// features; /revenue-stream → ?tab=lini). Hanya tab aktif yang mengambil data — data
// Scorecard (termasuk margin) tak pernah diambil untuk pemegang tab lini saja.
export default async function KinerjaProdukPage({ searchParams }: { searchParams: Promise<{ tab?: string; periode?: string; from?: string; to?: string }> }) {
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
    const rentang = rentangLini(sp);
    let data: StreamPayload | null = null;
    try {
      const res = await gatewayFetch(`/reports/revenue-by-stream?from=${rentang.from}&to=${rentang.to}`);
      if (res.ok) data = (await res.json()) as StreamPayload;
    } catch { data = null; }
    return <>{header}<PageTabs tabs={tabs} aktif={aktif} /><RevenueStreamView data={data} rentang={rentang} /></>;
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
