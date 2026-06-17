"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangeToolbar } from "@/components/ui/date-range-toolbar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
    id: "ringkas",
    header: "Item rencana",
    accessor: (t) => t.items.join(" "),
    cell: (t) => (
      <span className="text-muted-foreground block max-w-[22rem] truncate" title={t.items.join(" · ")}>
        {t.items[0] ? `${t.items[0]}${t.total_items > 1 ? ` +${t.total_items - 1} lainnya` : ""}` : "—"}
      </span>
    ),
    className: "max-w-[22rem]",
  },
  { id: "total", header: "Jumlah", align: "right", sortable: true, accessor: (t) => t.total_items, className: "w-16 whitespace-nowrap" },
  {
    id: "status",
    header: "Status",
    className: "whitespace-nowrap",
    cell: (t) => (
      <div className="flex flex-wrap gap-1">
        {t.is_late_plan && <Badge variant="destructive">late plan</Badge>}
        {t.reported ? <Badge variant="secondary">reported</Badge> : <Badge variant="outline">belum report</Badge>}
      </div>
    ),
  },
];

export function TodosTable({ todos }: { todos: TodoItem[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<TodoItem | null>(null);
  const filtered = useMemo(() => {
    if (!from && !to) return todos;
    return todos.filter((t) => {
      const d = (t.tanggal ?? "").slice(0, 10);
      return d ? (!from || d >= from) && (!to || d <= to) : false;
    });
  }, [todos, from, to]);
  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        getKey={(t) => t.id}
        searchPlaceholder="Cari AM / item…"
        pageSize={25}
        onRowClick={(t) => setSelected(t)}
        toolbar={<DateRangeToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="td" />}
      />

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.am_name ?? selected.am_id}</SheetTitle>
                <SheetDescription>
                  {tgl(selected.tanggal)} · {selected.total_items} item
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="flex flex-wrap gap-1">
                  {selected.is_late_plan && <Badge variant="destructive">late plan</Badge>}
                  {selected.reported ? <Badge variant="secondary">reported</Badge> : <Badge variant="outline">belum report</Badge>}
                </div>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                  {selected.items.map((it, i) => (
                    <li key={i} className="break-words whitespace-pre-wrap">
                      {it}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
