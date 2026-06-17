import { gatewayFetch } from "@/lib/gateway";
import { OverviewDashboard, type OverviewData } from "@/components/overview/overview-dashboard";

export const dynamic = "force-dynamic";

async function getInitial(): Promise<OverviewData | null> {
  try {
    const res = await gatewayFetch(`/dashboard/overview`);
    if (!res.ok) return null;
    return (await res.json()) as OverviewData;
  } catch {
    return null;
  }
}

export default async function OverviewPage() {
  const data = await getInitial();
  return <OverviewDashboard initial={data} />;
}
