import { Workflow, TrendingUp, CheckCircle2, ClipboardCheck } from "lucide-react";

import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface Stats {
  deals: {
    total: number;
    open: number;
    won: number;
    lost: number;
    total_value: number;
    open_value: number;
  };
  hitl_pending: number;
  activity_total: number;
  audit_events: number;
  by_stage: { stage: string; count: number }[];
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

async function getStats(): Promise<Stats | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/stats`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Stats;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const s = await getStats();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview operasional WRG-OS — data live dari DB."
      />

      {!s ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan{" "}
          <code>DATABASE_URL</code>.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Deal (Pipeline)"
              value={String(s.deals.total)}
              delta={`${rupiah(s.deals.total_value)} total estimasi`}
              icon={Workflow}
            />
            <StatCard
              title="Pipeline Aktif"
              value={String(s.deals.open)}
              delta={`${rupiah(s.deals.open_value)} nilai terbuka`}
              deltaTone="positive"
              icon={TrendingUp}
            />
            <StatCard
              title="Deal Closed"
              value={String(s.deals.won)}
              delta={`${s.deals.lost} lost`}
              deltaTone={s.deals.lost > 0 ? "negative" : "neutral"}
              icon={CheckCircle2}
            />
            <StatCard
              title="HITL Pending"
              value={String(s.hitl_pending)}
              delta={s.hitl_pending > 0 ? "perlu review" : "bersih"}
              deltaTone={s.hitl_pending > 0 ? "negative" : "positive"}
              icon={ClipboardCheck}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline per Stage</CardTitle>
              <CardDescription>Distribusi deal (live dari DB)</CardDescription>
            </CardHeader>
            <CardContent>
              {s.by_stage.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Belum ada deal. Kirim <code>#PLAN</code> via <code>/api/plan</code>.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Deal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.by_stage.map((row) => (
                      <TableRow key={row.stage}>
                        <TableCell className="font-medium">{row.stage}</TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            Governance: {s.audit_events} audit events · {s.activity_total} stage transitions tercatat.
          </p>
        </>
      )}
    </>
  );
}
