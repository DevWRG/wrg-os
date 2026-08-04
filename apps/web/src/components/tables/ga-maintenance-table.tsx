"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaMaintenanceActions, type AppUserOption } from "@/components/crm/ga-maintenance-actions";

export interface GaMaintenance {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  maint_type: string;
  due_date: string | null;
  status: string;
  overdue: boolean;
  cost_budget: number;
  cost_actual: number;
  vendor_id: string | null;
  vendor_nama: string | null;
  recur_months: number;
  recur_parent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Diminta", in_progress: "Dikerjakan", pending_finance: "Nunggu Finance", completed: "Selesai", cancelled: "Batal",
};
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  requested: "outline", in_progress: "secondary", pending_finance: "destructive", completed: "outline", cancelled: "secondary",
};
const MAINT_TYPE_LABEL: Record<string, string> = { preventive: "Preventive", corrective: "Corrective" };
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function GaMaintenanceTable({ schedules, canApproveFinance, users }: { schedules: GaMaintenance[]; canApproveFinance: boolean; users: AppUserOption[] }) {
  const columns: DataColumn<GaMaintenance>[] = [
    {
      id: "aset",
      header: "Aset",
      sortable: true,
      accessor: (s) => s.asset_code,
      cell: (s) => (
        <div>
          <div className="font-medium">{s.asset_code}</div>
          <div className="text-muted-foreground text-xs">{s.asset_nama}</div>
        </div>
      ),
    },
    { id: "tipe", header: "Tipe", cell: (s) => MAINT_TYPE_LABEL[s.maint_type] ?? s.maint_type },
    {
      id: "due",
      header: "Due",
      cell: (s) =>
        !s.due_date ? (
          <span className="text-muted-foreground text-xs">-</span>
        ) : s.overdue ? (
          <Badge variant="destructive">Lewat {fmtDate(s.due_date)}</Badge>
        ) : (
          <span className="text-xs">{fmtDate(s.due_date)}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>,
    },
    {
      id: "biaya",
      header: "Budget / Aktual",
      align: "right",
      cell: (s) => (
        <div className="text-right">
          <div className="text-xs">{rupiah(s.cost_budget)}</div>
          {s.cost_actual > 0 && <div className="text-muted-foreground text-xs">aktual: {rupiah(s.cost_actual)}</div>}
        </div>
      ),
    },
    { id: "vendor", header: "Vendor", cell: (s) => s.vendor_nama ?? <span className="text-muted-foreground text-xs">-</span> },
    {
      id: "recur",
      header: "Recur",
      cell: (s) => (s.recur_months > 0 ? <Badge variant="outline">{s.recur_months} bln</Badge> : <span className="text-muted-foreground text-xs">-</span>),
    },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (s) => <GaMaintenanceActions schedule={s} canApproveFinance={canApproveFinance} users={users} />,
    },
  ];

  return <DataTable columns={columns} data={schedules} getKey={(s) => s.id} searchPlaceholder="Cari kode aset / nama…" pageSize={25} />;
}
