import { AlertTriangle, ClipboardList, PackageCheck } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddPurchaseOrderSheet } from "@/components/crm/add-purchase-order-sheet";
import { PurchaseOrderTable, type PurchaseOrderRow } from "@/components/tables/purchase-order-table";

export const dynamic = "force-dynamic";

async function getPurchaseOrders(): Promise<PurchaseOrderRow[] | null> {
  try {
    const res = await gatewayFetch(`/purchase-orders?limit=1000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: PurchaseOrderRow[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function PurchaseOrdersPage() {
  const rows = await getPurchaseOrders();
  const today = new Date().toISOString().slice(0, 10);
  const berjalan = rows?.filter((r) => r.status === "ordered" || r.status === "partial_received").length ?? 0;
  const telat =
    rows?.filter((r) => (r.status === "ordered" || r.status === "partial_received") && r.eta_date && r.eta_date < today).length ?? 0;
  const received = rows?.filter((r) => r.status === "received").length ?? 0;

  return (
    <>
      <PageHeader
        title="PO Tracker & Barang Masuk"
        description="Lacak PO ke vendor sampai barang diterima (F13) — status & riwayat penerimaan dihitung otomatis dari log barang masuk."
        action={<AddPurchaseOrderSheet />}
      />
      {rows && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="PO berjalan" value={String(berjalan)} icon={ClipboardList} />
          <StatCard title="PO telat" value={String(telat)} deltaTone={telat > 0 ? "negative" : "neutral"} delta={telat > 0 ? "ETA sudah lewat, belum diterima penuh" : undefined} icon={AlertTriangle} />
          <StatCard title="PO diterima penuh" value={String(received)} icon={PackageCheck} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terhubung." />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada PO" description="Tambah lewat tombol Tambah PO di atas." />
          ) : (
            <PurchaseOrderTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
