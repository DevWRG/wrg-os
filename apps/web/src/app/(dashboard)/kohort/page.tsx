import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KohortView } from "@/components/kohort/kohort-view";

export const dynamic = "force-dynamic";

// F96 Cohort & Lead Source Analytics — dashboard saja (tanpa hashtag), hanya baca, agregat.
// Kunci izin 'kohort', default tertutup: butuh Sync Fitur + centang Akses Grup; sebelum itu
// fallback Direktur/admin/HoD (lib/kohort-access.ts).
export default async function KohortPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/kohort", "view")) {
    return (
      <>
        <PageHeader title="Kohort & Lead Source" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Kohort & Lead Source"
        description="Retensi customer per kohort kuartal, dan pipeline lead per sumber × status × kuartal. Hanya baca. (F96)"
      />
      <KohortView />
    </>
  );
}
