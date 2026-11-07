import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { profitabilitasAccess } from "@/lib/profitabilitas-area-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RevenueAreaView } from "@/components/revenue-area/revenue-area-view";

export const dynamic = "force-dynamic";

// F150 Profitabilitas Area — biaya operasional vs revenue netto per area. Tahap 1: sisi
// revenue sudah hidup; biaya & profit menunggu data Accurate (BRIEF-F150-DATA-BIAYA-ACCURATE.md).
// Kunci izin 'profitabilitas-area', default tertutup: butuh Sync Fitur + centang Akses Grup.
export default async function ProfitabilitasAreaPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/profitabilitas-area", "view")) {
    return (
      <>
        <PageHeader title="Profitabilitas Area" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const terbatas = profitabilitasAccess(me) === "hod";
  return (
    <>
      <PageHeader
        title="Profitabilitas Area"
        description={`Revenue netto per area, dibandingkan periode sebelumnya${terbatas ? " — hanya cabang Anda" : ""}. Kolom biaya & profit/rugi menyusul setelah data biaya Accurate tersedia. (F150)`}
      />
      <RevenueAreaView endpoint="/api/revenue-area" tampilkanBiaya />
    </>
  );
}
