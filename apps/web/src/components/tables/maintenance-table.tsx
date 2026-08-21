"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { MaintenanceRowActions } from "@/components/crm/maintenance-row-actions";

export interface MaintenanceSchedule {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  interval_bulan: number;
  due_date: string;
  teknisi_name: string | null;
  status: string;
  completed_count: number;
}

const STATUS_LABEL: Record<string, string> = { scheduled: "Scheduled", notified: "Notified (H-14)" };
const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "notified" ? "default" : "outline";

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function MaintenanceTable({ schedules }: { schedules: MaintenanceSchedule[] }) {
  const columns: DataColumn<MaintenanceSchedule>[] = [
    {
      id: "alat",
      header: "Alat",
      sortable: true,
      accessor: (s) => s.alat_name,
      cell: (s) => (
        <div>
          <div className="font-medium">{s.alat_name}</div>
          {s.serial_number && <div className="text-muted-foreground text-xs">SN: {s.serial_number}</div>}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      sortable: true,
      accessor: (s) => s.customer_name,
      cell: (s) => (
        <div>
          <div>{s.customer_name}</div>
          {s.cabang && <div className="text-muted-foreground text-xs">{s.cabang}</div>}
        </div>
      ),
    },
    { id: "interval", header: "Interval", sortable: true, accessor: (s) => s.interval_bulan, cell: (s) => `${s.interval_bulan} bln` },
    { id: "due", header: "Due date", sortable: true, accessor: (s) => s.due_date, cell: (s) => <span className="whitespace-nowrap">{tgl(s.due_date)}</span> },
    { id: "status", header: "Status", sortable: true, accessor: (s) => s.status, cell: (s) => <Badge variant={statusTone(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge> },
    { id: "teknisi", header: "Teknisi", accessor: (s) => s.teknisi_name ?? "", cell: (s) => s.teknisi_name ?? "—" },
    { id: "siklus", header: "Siklus", align: "right", accessor: (s) => s.completed_count, cell: (s) => s.completed_count },
    { id: "aksi", header: "Aksi", align: "right", cell: (s) => <MaintenanceRowActions row={s} /> },
  ];

  return (
    <DataTable columns={columns} data={schedules} getKey={(s) => s.id} searchPlaceholder="Cari alat / customer…" pageSize={25} />
  );
}
