import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserInfographic } from "@/components/dashboard/user-infographic";

export const dynamic = "force-dynamic";

// Infografis per-user (Plan & Report + Visit untuk AM / Todo untuk non-AM).
// Default rentang = semua data; filter di dalam komponen. Data via /report/drilldown.
export default async function DrilldownPage({
  searchParams,
}: {
  searchParams: Promise<{ am_id?: string; from?: string; to?: string }>;
}) {
  const { am_id, from, to } = await searchParams;

  return (
    <>
      <div className="flex items-center gap-3">
        <Button render={<Link href="/dashboard" />} nativeButton={false} variant="outline" size="icon-sm">
          <ArrowLeft />
        </Button>
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Infografis Karyawan
        </p>
      </div>

      {!am_id ? (
        <p className="text-muted-foreground">
          Parameter <code>am_id</code> wajib. Kembali ke{" "}
          <Link href="/dashboard" className="text-primary underline">dashboard</Link>.
        </p>
      ) : (
        <UserInfographic amId={am_id} initialFrom={from} initialTo={to} />
      )}
    </>
  );
}
