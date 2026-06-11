"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface ReminderItem {
  id: string;
  am_id: string;
  am_name: string | null;
  reminder_date: string;
  note: string;
  customer_name: string | null;
  fired_h_minus_1: boolean;
  fired_h: boolean;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const columns: DataColumn<ReminderItem>[] = [
  { id: "am", header: "AM", sortable: true, accessor: (r) => r.am_name ?? r.am_id, cell: (r) => <span className="font-medium">{r.am_name ?? r.am_id}</span> },
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => r.reminder_date, cell: (r) => <span className="text-muted-foreground">{tgl(r.reminder_date)}</span> },
  { id: "note", header: "Note", sortable: true, accessor: (r) => r.note },
  { id: "customer", header: "Customer", accessor: (r) => r.customer_name ?? "", cell: (r) => <span className="text-muted-foreground">{r.customer_name ?? "—"}</span> },
  {
    id: "status",
    header: "Status kirim",
    cell: (r) => (
      <div className="flex gap-1">
        {r.fired_h_minus_1 && <Badge variant="secondary">H-1 terkirim</Badge>}
        {r.fired_h && <Badge variant="secondary">H terkirim</Badge>}
        {!r.fired_h_minus_1 && !r.fired_h && <Badge variant="outline">menunggu</Badge>}
      </div>
    ),
  },
];

export function RemindersTable({ reminders }: { reminders: ReminderItem[] }) {
  return <DataTable columns={columns} data={reminders} getKey={(r) => r.id} searchPlaceholder="Cari AM / note / customer…" pageSize={25} />;
}
