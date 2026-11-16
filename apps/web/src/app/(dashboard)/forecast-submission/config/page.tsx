import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { ForecastConfigView } from "@/components/forecast/forecast-config-view";

export const dynamic = "force-dynamic";

// F19 Setup Buffer & Wilayah. Simpan ikut izin edit /forecast-submission (gerbang POST BFF).
export default async function ForecastBufferConfigPage() {
  const me = await sessionUser();
  return <ForecastConfigView bisaUbah={!!me && featureAllowed(me, "/forecast-submission", "edit")} />;
}
