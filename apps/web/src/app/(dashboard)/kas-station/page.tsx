import { sessionUser } from "@/lib/admin-guard";
import { canKasStation, canKasStationReview, canViewKasStation } from "@/lib/kas-station-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KasStationView } from "@/components/kas-station/kas-station-view";

export const dynamic = "force-dynamic";

// F33 Kas Station Reconcile Harian Cabang — station (= kas cabang) mencatat kas harian, sistem merekap
// per minggu (Senin–Minggu), station mengajukan, pusat meninjau & approve/reject, lalu dana direalisasikan.
// Dua kunci izin: 'kas-station' (station) dan 'kas-station-review' (pusat) — lib/kas-station-access.ts.
// Izin di sini hanya mengatur tampilan; penegakan sebenarnya di BFF app/api/kas-station.
export default async function KasStationPage() {
  const me = await sessionUser();
  if (!canViewKasStation(me)) {
    return (
      <>
        <PageHeader title="Kas Station" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Kas Station"
        description="Kas harian cabang direkap otomatis per minggu, lalu diajukan ke pusat untuk disetujui dan direalisasikan."
      />
      <KasStationView
        izin={{
          stationView: canKasStation(me, "view"), stationCreate: canKasStation(me, "create"),
          stationEdit: canKasStation(me, "edit"), stationDelete: canKasStation(me, "delete"),
          reviewView: canKasStationReview(me, "view"), reviewEdit: canKasStationReview(me, "edit"),
        }}
      />
    </>
  );
}
