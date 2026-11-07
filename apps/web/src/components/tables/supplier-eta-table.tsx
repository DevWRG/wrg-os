"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { SupplierEtaRowActions } from "@/components/crm/supplier-eta-row-actions";
import { cn } from "@/lib/utils";

export interface SupplierEtaRow {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  po_number: string | null;
  item_desc: string;
  qty: number | null;
  eta_date: string;
  status: "pending" | "arrived" | "cancelled";
  actual_arrival_date: string | null;
  cabang: string | null;
  notes: string | null;
  overdue: boolean;
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_LABEL: Record<SupplierEtaRow["status"], string> = {
  pending: "Pending",
  arrived: "Sudah datang",
  cancelled: "Dibatalkan",
};

function StatusBadge({ row }: { row: SupplierEtaRow }) {
  if (row.overdue) return <Badge variant="destructive">Telat</Badge>;
  if (row.status === "arrived") return <Badge className="bg-success/10 text-success">{STATUS_LABEL.arrived}</Badge>;
  if (row.status === "cancelled") return <Badge variant="secondary">{STATUS_LABEL.cancelled}</Badge>;
  return <Badge variant="outline">{STATUS_LABEL.pending}</Badge>;
}

const columns: DataColumn<SupplierEtaRow>[] = [
  { id: "vendor", header: "Supplier", sortable: true, accessor: (r) => r.vendor_name, cell: (r) => <span className="font-medium">{r.vendor_name}</span> },
  { id: "po", header: "PO / Ref", sortable: true, accessor: (r) => r.po_number ?? "", cell: (r) => r.po_number ?? "—" },
  {
    id: "item",
    header: "Barang",
    sortable: true,
    accessor: (r) => r.item_desc,
    cell: (r) => (
      <div>
        <div>{r.item_desc}</div>
        {r.qty != null && <div className="text-muted-foreground text-xs">Qty {r.qty}</div>}
      </div>
    ),
  },
  {
    id: "eta",
    header: "ETA",
    sortable: true,
    accessor: (r) => r.eta_date,
    cell: (r) => <span className={cn("whitespace-nowrap", r.overdue && "text-destructive font-medium")}>{tgl(r.eta_date)}</span>,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <SupplierEtaRowActions row={r} /> },
];

export function SupplierEtaTable({ rows }: { rows: SupplierEtaRow[] }) {
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari supplier / barang / PO…" pageSize={25} />;
}
