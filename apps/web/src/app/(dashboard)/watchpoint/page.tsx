import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { WatchPointBoardView, type WatchPointBoard } from "@/components/watchpoint/watchpoint-board";

export const dynamic = "force-dynamic";

async function getInitial(): Promise<WatchPointBoard | null> {
  try {
    const res = await gatewayFetch(`/watchpoint`);
    if (!res.ok) return null;
    return (await res.json()) as WatchPointBoard;
  } catch {
    return null;
  }
}

export default async function WatchPointPage() {
  const data = await getInitial();
  return (
    <div className="space-y-6">
      <PageHeader
        title="WatchPoint HoD"
        description="Status mingguan per Head of Department lintas perspektif Balanced Scorecard."
      />
      <WatchPointBoardView initial={data} />
    </div>
  );
}
