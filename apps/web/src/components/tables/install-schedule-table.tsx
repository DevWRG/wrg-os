"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ScheduleRowActions } from "@/components/crm/schedule-row-actions";

export interface InstallSchedule {
  id: string;
  alat_name: string;
  customer_name: string;
  teknisi_nama: string | null;
  scheduled_date: string;
  status: string;
}

const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "done" ? "secondary" : s === "cancelled" ? "destructive" : "outline";

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function InstallScheduleTable({ schedule }: { schedule: InstallSchedule[] }) {
  const columns: DataColumn<InstallSchedule>[] = [
    { id: "alat", header: "Alat", sortable: true, accessor: (s) => s.alat_name, cell: (s) => <span className="font-medium">{s.alat_name}</span> },
    { id: "customer", header: "Customer", sortable: true, accessor: (s) => s.customer_name },
    { id: "teknisi", header: "Teknisi", accessor: (s) => s.teknisi_nama ?? "", cell: (s) => s.teknisi_nama ?? "—" },
    { id: "tanggal", header: "Tanggal", sortable: true, accessor: (s) => s.scheduled_date, cell: (s) => tgl(s.scheduled_date) },
    { id: "status", header: "Status", sortable: true, accessor: (s) => s.status, cell: (s) => <Badge variant={statusTone(s.status)}>{s.status}</Badge> },
    { id: "aksi", header: "Aksi", align: "right", cell: (s) => <ScheduleRowActions row={s} /> },
  ];

  return <DataTable columns={columns} data={schedule} getKey={(s) => s.id} searchPlaceholder="Cari alat / customer…" pageSize={25} />;
}
