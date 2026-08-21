"use client";

import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { InventoryRelocationRowActions } from "@/components/purchasing/inventory-relocation-row-actions";

export type InventoryRelocationStatus = "pending" | "completed" | "cancelled";

export interface InventoryRelocationRow {
  id: string;
  item_desc: string;
  qty: number;
  unit: string | null;
  cabang_asal: string;
  cabang_tujuan: string;
  reason: string | null;
  requested_by: string | null;
  request_date: string;
  status: InventoryRelocationStatus;
  completed_at: string | null;
  notes: string | null;
}

const tgl = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_BADGE: Record<InventoryRelocationStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-warning-soft text-warning" },
  completed: { label: "Selesai", cls: "bg-success-soft text-success" },
  cancelled: { label: "Dibatalkan", cls: "bg-muted text-muted-foreground" },
};

export function InventoryRelocationTable({ rows }: { rows: InventoryRelocationRow[] }) {
  const columns: DataColumn<InventoryRelocationRow>[] = [
    { id: "item", header: "Barang", sortable: true, accessor: (r) => r.item_desc, cell: (r) => <span className="font-medium">{r.item_desc}</span> },
    { id: "qty", header: "Qty", sortable: true, accessor: (r) => r.qty, cell: (r) => `${r.qty}${r.unit ? ` ${r.unit}` : ""}` },
    {
      id: "rute",
      header: "Cabang Asal → Tujuan",
      sortable: true,
      accessor: (r) => r.cabang_asal,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {r.cabang_asal} <ArrowRight className="text-muted-foreground size-3.5" /> {r.cabang_tujuan}
        </span>
      ),
    },
    { id: "tanggal", header: "Tgl Request", sortable: true, accessor: (r) => r.request_date, cell: (r) => tgl(r.request_date) },
    { id: "requested_by", header: "Diminta oleh", accessor: (r) => r.requested_by ?? "", cell: (r) => r.requested_by ?? "—" },
    { id: "reason", header: "Alasan", accessor: (r) => r.reason ?? "", cell: (r) => r.reason ?? "—" },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (r) => r.status,
      cell: (r) => {
        const b = STATUS_BADGE[r.status];
        return <Badge className={b.cls}>{b.label}</Badge>;
      },
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (r) => <InventoryRelocationRowActions row={r} /> },
  ];

  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari barang / cabang…" pageSize={25} />;
}
