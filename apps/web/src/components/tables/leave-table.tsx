"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { LeaveRowActions } from "@/components/crm/leave-row-actions";

interface Leave {
  id: string;
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: string;
  keterangan: string | null;
  source: string;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const jenisTone = (j: string): "default" | "secondary" | "destructive" | "outline" =>
  j === "sakit" ? "destructive" : j === "cuti" ? "secondary" : "outline";

export function LeaveTable({ leave, nameById }: { leave: Leave[]; nameById: Record<string, string> }) {
  const name = (id: string) => nameById[id] ?? id;
  const columns: DataColumn<Leave>[] = [
    { id: "karyawan", header: "Karyawan", sortable: true, accessor: (l) => name(l.am_id), cell: (l) => <span className="font-medium">{name(l.am_id)}</span> },
    { id: "jenis", header: "Jenis", sortable: true, accessor: (l) => l.jenis, cell: (l) => <Badge variant={jenisTone(l.jenis)}>{l.jenis}</Badge> },
    { id: "start", header: "Mulai", sortable: true, accessor: (l) => l.start_date, cell: (l) => <span className="text-muted-foreground whitespace-nowrap">{tgl(l.start_date)}</span> },
    { id: "end", header: "Selesai", sortable: true, accessor: (l) => l.end_date, cell: (l) => <span className="text-muted-foreground whitespace-nowrap">{tgl(l.end_date)}</span> },
    { id: "ket", header: "Keterangan", accessor: (l) => l.keterangan ?? "", cell: (l) => <div className="text-muted-foreground max-w-[280px] truncate" title={l.keterangan ?? undefined}>{l.keterangan ?? "—"}</div> },
    { id: "source", header: "Sumber", sortable: true, accessor: (l) => l.source, cell: (l) => <Badge variant="outline">{l.source}</Badge> },
    { id: "aksi", header: "Aksi", align: "right", cell: (l) => <LeaveRowActions row={l} label={name(l.am_id)} /> },
  ];
  return <DataTable columns={columns} data={leave} getKey={(l) => l.id} searchPlaceholder="Cari karyawan / jenis…" pageSize={25} />;
}
