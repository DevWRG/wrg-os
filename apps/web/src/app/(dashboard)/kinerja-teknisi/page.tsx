import { sessionUser } from "@/lib/admin-guard";
import { canViewKinerjaTeknisi } from "@/lib/kinerja-teknisi-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KinerjaTeknisiView } from "@/components/kinerja-teknisi/kinerja-view";

export const dynamic = "force-dynamic";

// Kinerja Teknisi (Aftersales): jadwal per teknisi + Plan & Report (durasi, SLA tiket vs ETA, kepatuhan).
// Data dari #PLAN/#START/#REPORT teknisi (F175) dan modul Aftersales. Cakupan teknisi ditegakkan apps/api.
export default async function KinerjaTeknisiPage() {
  const me = await sessionUser();
  if (!canViewKinerjaTeknisi(me)) {
    return (
      <>
        <PageHeader title="Kinerja Teknisi" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Kinerja Teknisi"
        description="Jadwal tiap teknisi (PM, kunjungan rutin, install, tiket) dan hasil #PLAN/#START/#REPORT: waktu kerja, SLA tiket terhadap ETA, dan kepatuhan harian."
      />
      <KinerjaTeknisiView />
    </>
  );
}
