"use client";

import { useState } from "react";

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
import { useTableUrl } from "@/lib/use-table-url";

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

/** State tabel di URL; id kolom urut = TODO_SORTS di apps/api repo/todo.ts. */
export interface TodoQuery {
  q: string;
  from: string;
  to: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  size: number;
}

// Mode server: cari (nama + isi item), rentang tanggal, urut, dan halaman
// dikerjakan backend atas SELURUH plan.
export function TodosTable({ todos, totalRows, query }: { todos: TodoItem[]; totalRows: number; query: TodoQuery }) {
  const { push, qInput, setQInput, pending } = useTableUrl(query.q);
  const [selected, setSelected] = useState<TodoItem | null>(null);
  return (
    <>
      <DataTable
        columns={columns}
        data={todos}
        getKey={(t) => t.id}
        searchPlaceholder="Cari nama / item…"
        onRowClick={(t) => setSelected(t)}
        server={{
          totalRows,
          page: query.page,
          pageSize: query.size,
          sort: { id: query.sort, dir: query.dir },
          q: qInput,
          pending,
          onPageChange: (p) => push({ page: p === 0 ? null : p }),
          onPageSizeChange: (n) => push({ size: n, page: null }),
          onSortChange: (s) => push({ sort: s?.id ?? null, dir: s?.dir ?? null, page: null }),
          onSearchChange: setQInput,
        }}
        toolbar={
          <DateRangeToolbar
            from={query.from}
            to={query.to}
            onFrom={(v) => push({ from: v || null, page: null })}
            onTo={(v) => push({ to: v || null, page: null })}
            idPrefix="td"
          />
        }
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
