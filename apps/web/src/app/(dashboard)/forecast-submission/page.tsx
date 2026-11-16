import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { ForecastSubmissionView } from "@/components/forecast/forecast-view";

export const dynamic = "force-dynamic";

// F19 Forecast Submission. Gerbang menu ditegakkan layout (navVisible); izin
// tombol ikut aksi yang dicek BFF /api/forecast/** supaya pemakai hanya-lihat
// tak melihat tombol yang akan ditolak 403.
export default async function ForecastSubmissionPage() {
  const me = await sessionUser();
  return (
    <ForecastSubmissionView
      bisaBuat={!!me && featureAllowed(me, "/forecast-submission", "create")}
      bisaUbah={!!me && featureAllowed(me, "/forecast-submission", "edit")}
    />
  );
}
