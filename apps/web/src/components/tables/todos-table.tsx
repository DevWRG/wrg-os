"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangeToolbar } from "@/components/ui/date-range-toolbar";

interface TodoItem {
  id: string;
  am_id: string;
  am_name: string | null;
  tanggal: string;
  items: string[];
  total_items: number;
  is_late_plan: boolean;
  reported: boolean;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const columns: DataColumn<TodoItem>[] = [
  { id: "am", header: "AM", sortable: true, accessor: (t) => t.am_name ?? t.am_id, cell: (t) => <span className="font-medium">{t.am_name ?? t.am_id}</span> },
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (t) => t.tanggal, cell: (t) => <span className="text-muted-foreground">{tgl(t.tanggal)}</span> },
  {
    id: "items",
    header: "Item rencana",
    accessor: (t) => t.items.join(" "),
    cell: (t) =>
      t.items.length > 0 ? (
        <ol className="list-decimal space-y-0.5 pl-4 text-sm">
          {t.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    className: "max-w-md",
  },
  { id: "total", header: "Jumlah", align: "right", sortable: true, accessor: (t) => t.total_items },
  {
    id: "status",
    header: "Status",
    cell: (t) => (
      <div className="flex gap-1">
        {t.is_late_plan && <Badge variant="destructive">late plan</Badge>}
        {t.reported ? <Badge variant="secondary">reported</Badge> : <Badge variant="outline">belum report</Badge>}
      </div>
    ),
  },
];

export function TodosTable({ todos }: { todos: TodoItem[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = useMemo(() => {
    if (!from && !to) return todos;
    return todos.filter((t) => {
      const d = (t.tanggal ?? "").slice(0, 10);
      return d ? (!from || d >= from) && (!to || d <= to) : false;
    });
  }, [todos, from, to]);
  return (
    <DataTable
      columns={columns}
      data={filtered}
      getKey={(t) => t.id}
      searchPlaceholder="Cari AM / item…"
      pageSize={25}
      toolbar={<DateRangeToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="td" />}
    />
  );
}
