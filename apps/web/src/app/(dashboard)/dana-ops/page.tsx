import { AlertTriangle, Receipt, Wallet } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewDanaOps } from "@/lib/dana-ops-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddDanaOpsSheet } from "@/components/crm/add-dana-ops-sheet";
import { DanaOpsTable, type DanaOpsRow } from "@/components/tables/dana-ops-table";

export const dynamic = "force-dynamic";

const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

async function getDanaOps(): Promise<DanaOpsRow[] | null> {
  try {
    const res = await gatewayFetch(`/dana-ops?limit=1000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: DanaOpsRow[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function DanaOpsPage() {
  const me = await sessionUser();
  if (!canViewDanaOps(me)) {
    return (
      <>
        <PageHeader title="Dana Ops / Petty Cash Realization" description="Realisasi dana operasional (uang muka/petty cash)." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }

  const rows = await getDanaOps();
  const inProgress = rows?.filter((r) => r.status === "in_progress").length ?? 0;
  const outstanding = rows?.filter((r) => r.status === "in_progress").reduce((s, r) => s + (r.amount_requested - r.amount_realized), 0) ?? 0;
  const realizedThisMonth =
    rows?.filter((r) => r.status === "realized" && (r.realized_at ?? "").slice(0, 7) === new Date().toISOString().slice(0, 7)).length ?? 0;

  return (
    <>
      <PageHeader
        title="Dana Ops / Petty Cash Realization"
        description="Realisasi dana operasional (uang muka/petty cash) — F51, General Affairs."
        action={<AddDanaOpsSheet />}
      />
      {rows && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Sedang berjalan" value={String(inProgress)} icon={Wallet} />
          <StatCard title="Belum direalisasi" value={rupiah(outstanding)} deltaTone={outstanding > 0 ? "negative" : "neutral"} icon={AlertTriangle} />
          <StatCard title="Direalisasi bulan ini" value={String(realizedThisMonth)} icon={Receipt} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terhubung." />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada pengajuan dana ops" description="Tambah lewat tombol Ajukan Dana di atas." />
          ) : (
            <DanaOpsTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
