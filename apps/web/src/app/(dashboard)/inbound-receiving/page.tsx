import { AlertTriangle, ClipboardList, PackageCheck } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncAccurateButton, type AccurateSyncStatus } from "@/components/crm/sync-accurate-button";
import { InboundReceivingTable, type InboundReceivingRow } from "@/components/tables/inbound-receiving-table";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

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

export default async function InboundReceivingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  // Kartu KPI dari endpoint agregat SQL — dulu rows.filter() atas ?limit=1000
  // (ikut salah begitu penerimaan lewat 1000) dan "bulan ini" pakai tanggal UTC.
  const [rows, summary, syncStatus] = await Promise.all([
    getInboundReceiving(),
    getJson<{ in_progress: number; ready_to_close: number; completed_this_month: number }>("/inbound-receiving/summary"),
    getJson<AccurateSyncStatus>("/inbound-receiving/sync-status"),
  ]);
  const inProgress = summary?.in_progress ?? 0;
  const readyToClose = summary?.ready_to_close ?? 0;
  const completedThisMonth = summary?.completed_this_month ?? 0;

  return (
    <>
      <PageHeader
        title="Inbound Receiving Checklist"
        description="Checklist verifikasi barang datang (F36). Penerimaan Barang dicatat di Accurate — tiap dokumen INBOUND otomatis muncul di sini untuk dicek gudang."
        action={<SyncAccurateButton initial={syncStatus} endpoint="/api/inbound-receiving/sync" />}
      />
      {summary && (
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
            <EmptyState title="Belum ada penerimaan barang" description="Penerimaan Barang dibuat di Accurate. Klik Sinkron dari Accurate di atas untuk menyalinnya." />
          ) : (
            <InboundReceivingTable rows={rows} initialQuery={q || undefined} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
