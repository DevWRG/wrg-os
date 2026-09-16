import { AlertTriangle, ClipboardList, PackageCheck } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddInboundReceivingSheet } from "@/components/crm/add-inbound-receiving-sheet";
import { InboundReceivingTable, type InboundReceivingRow } from "@/components/tables/inbound-receiving-table";

export const dynamic = "force-dynamic";

async function getInboundReceiving(): Promise<InboundReceivingRow[] | null> {
  try {
    const res = await gatewayFetch(`/inbound-receiving?limit=1000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: InboundReceivingRow[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function InboundReceivingPage() {
  const rows = await getInboundReceiving();
  const inProgress = rows?.filter((r) => r.status === "in_progress").length ?? 0;
  const readyToClose = rows?.filter((r) => r.status === "in_progress" && r.item_count > 0 && r.checked_count === r.item_count).length ?? 0;
  const completedThisMonth =
    rows?.filter((r) => r.status === "completed" && r.received_date.slice(0, 7) === new Date().toISOString().slice(0, 7)).length ?? 0;

  return (
    <>
      <PageHeader
        title="Inbound Receiving Checklist"
        description="Checklist verifikasi saat barang datang dari supplier (F36) — jumlah, kondisi fisik, dokumen, dan spesifikasi."
        action={<AddInboundReceivingSheet />}
      />
      {rows && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Sedang diproses" value={String(inProgress)} icon={ClipboardList} />
          <StatCard title="Siap ditutup" value={String(readyToClose)} deltaTone={readyToClose > 0 ? "positive" : "neutral"} delta={readyToClose > 0 ? "Checklist lengkap, belum ditandai selesai" : undefined} icon={AlertTriangle} />
          <StatCard title="Selesai bulan ini" value={String(completedThisMonth)} icon={PackageCheck} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terhubung." />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada penerimaan barang" description="Tambah lewat tombol Barang Datang di atas." />
          ) : (
            <InboundReceivingTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
