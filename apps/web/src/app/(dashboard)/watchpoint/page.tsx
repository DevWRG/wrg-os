import Link from "next/link";
import { MapPin } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import type { WatchBoard } from "@/components/watchpoint/watchpoint-board";
import { WatchPointTabs } from "@/components/watchpoint/watchpoint-tabs";

export const dynamic = "force-dynamic";

async function getInitial(): Promise<WatchBoard | null> {
  try {
    const res = await gatewayFetch(`/watchpoint`);
    if (!res.ok) return null;
    return (await res.json()) as WatchBoard;
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
        description="Status per Head of Department — metric WatchPoint vs target. Tab Weekly: papan per minggu ISO + export deck PPT."
        action={
          <Button render={<Link href="/watchpoint/territory" />} nativeButton={false} variant="outline" size="sm">
            <MapPin /> Kelola Territory
          </Button>
        }
      />
      <WatchPointTabs initial={data} />
    </div>
  );
}
