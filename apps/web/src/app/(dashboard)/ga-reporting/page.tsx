import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewGaReporting } from "@/lib/ga-reporting-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { GaReportingDashboard, type GaReportingData } from "@/components/ga-reporting/ga-reporting-dashboard";

export const dynamic = "force-dynamic";

async function getGaReportingSummary(): Promise<GaReportingData | null> {
  try {
    const res = await gatewayFetch(`/ga-reporting/summary`);
    if (!res.ok) return null;
    return (await res.json()) as GaReportingData;
  } catch {
    return null;
  }
}

export default async function GaReportingPage() {
  const me = await sessionUser();
  if (!canViewGaReporting(me)) {
    return (
      <>
        <PageHeader title="GA Reporting & Analytics Dashboard" description="Konsolidasi laporan 6 modul General Affairs." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }

  const initial = await getGaReportingSummary();
  return <GaReportingDashboard initial={initial} />;
}
