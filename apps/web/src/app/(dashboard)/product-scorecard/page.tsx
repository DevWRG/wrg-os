import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewMargin, canViewProductScorecard } from "@/lib/product-scorecard-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductScorecardView, type DataScorecard } from "@/components/product-scorecard/scorecard-view";

export const dynamic = "force-dynamic";

// F6 Product Performance Scorecard. Gerbang menu juga ditegakkan layout (navVisible);
// cek di sini supaya halaman tak pernah memuat data untuk yang tak berhak.
export default async function ProductScorecardPage() {
  const me = await sessionUser();
  if (!canViewProductScorecard(me)) {
    return (
      <>
        <PageHeader title="Product Scorecard" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  let data: DataScorecard | null = null;
  try {
    const q = new URLSearchParams({ level: "kategori" });
    if (canViewMargin(me)) q.set("margin", "1");
    const r = await gatewayFetch(`/product-scorecard?${q.toString()}`, { headers: me ? { "x-user-id": me.id } : {} });
    if (r.ok) data = (await r.json()) as DataScorecard;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="Product Scorecard"
        description="Kinerja produk per kategori → lini → brand → item: revenue & tren, konsentrasi customer, perputaran stok, tekanan kompetitor, dan margin (khusus pembaca HPP)."
      />
      <ProductScorecardView awal={data} />
    </>
  );
}
