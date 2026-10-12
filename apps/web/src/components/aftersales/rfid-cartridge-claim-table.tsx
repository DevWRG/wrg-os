"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { RfidCartridgeClaimRowActions } from "@/components/aftersales/rfid-cartridge-claim-row-actions";

export interface RfidCartridgeClaim {
  id: string;
  device_name: string;
  cartridge_name: string;
  lot_number: string | null;
  serial_number: string | null;
  customer_name: string;
  error_description: string;
  reported_date: string;
  reported_by: string;
  cabang: string | null;
  status: "pending" | "resolved" | "rejected";
  resolution_notes: string | null;
  closed_at: string | null;
  notes: string | null;
  has_file: boolean;
  file_name: string | null;
}

const STATUS_LABEL: Record<RfidCartridgeClaim["status"], string> = {
  pending: "Menunggu",
  resolved: "Selesai",
  rejected: "Ditolak",
};
const STATUS_VARIANT: Record<RfidCartridgeClaim["status"], "outline" | "secondary" | "destructive"> = {
  pending: "outline",
  resolved: "secondary",
  rejected: "destructive",
};

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const columns: DataColumn<RfidCartridgeClaim>[] = [
  {
    id: "device_name",
    header: "Alat / Cartridge",
    sortable: true,
    accessor: (r) => r.device_name,
    cell: (r) => (
      <div>
        <div className="font-medium">{r.device_name}</div>
        <div className="text-muted-foreground text-xs">{r.cartridge_name}</div>
      </div>
    ),
  },
  { id: "customer_name", header: "Customer", sortable: true, accessor: (r) => r.customer_name },
  { id: "reported_date", header: "Tgl Lapor", sortable: true, accessor: (r) => r.reported_date, cell: (r) => <span className="whitespace-nowrap">{tgl(r.reported_date)}</span> },
  { id: "reported_by", header: "Pelapor", sortable: true, accessor: (r) => r.reported_by },
  {
    id: "status",
    header: "Status",
    sortable: true,
    accessor: (r) => r.status,
    cell: (r) => (
      <div>
        <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {r.closed_at && <div className="text-muted-foreground mt-1 text-xs whitespace-nowrap">Ditutup {tgl(r.closed_at)}</div>}
      </div>
    ),
  },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <RfidCartridgeClaimRowActions claim={r} /> },
];

export function RfidCartridgeClaimTable({ claims }: { claims: RfidCartridgeClaim[] }) {
  return <DataTable columns={columns} data={claims} getKey={(r) => r.id} searchPlaceholder="Cari alat / cartridge / customer…" pageSize={25} />;
}
