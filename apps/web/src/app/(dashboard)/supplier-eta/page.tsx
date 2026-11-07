import { AlertTriangle, Clock, PackageCheck } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddSupplierEtaSheet } from "@/components/crm/add-supplier-eta-sheet";
import { SupplierEtaTable, type SupplierEtaRow } from "@/components/tables/supplier-eta-table";

export const dynamic = "force-dynamic";

async function getSupplierEta(): Promise<SupplierEtaRow[] | null> {
  try {
    const res = await gatewayFetch(`/supplier-eta?limit=1000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: SupplierEtaRow[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function SupplierEtaPage() {
  const rows = await getSupplierEta();
  const overdue = rows?.filter((r) => r.overdue).length ?? 0;
  const pending = rows?.filter((r) => r.status === "pending").length ?? 0;
  const arrivedThisMonth =
    rows?.filter((r) => r.status === "arrived" && r.actual_arrival_date?.slice(0, 7) === new Date().toISOString().slice(0, 7)).length ?? 0;

  return (
    <>
      <PageHeader
        title="Supplier ETA Tracker"
        description="Estimasi tanggal barang datang dari supplier (F39) — pantau yang telat sebelum jadi masalah."
        action={<AddSupplierEtaSheet />}
      />
      {rows && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Telat" value={String(overdue)} deltaTone={overdue > 0 ? "negative" : "neutral"} delta={overdue > 0 ? "ETA lewat, belum datang" : undefined} icon={AlertTriangle} />
          <StatCard title="Pending" value={String(pending)} icon={Clock} />
          <StatCard title="Datang bulan ini" value={String(arrivedThisMonth)} icon={PackageCheck} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terhubung." />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada catatan ETA" description="Tambah lewat tombol Tambah ETA di atas." />
          ) : (
            <SupplierEtaTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
