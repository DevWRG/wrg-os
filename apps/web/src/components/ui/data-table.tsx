"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataColumn<T> {
  id: string;
  header: string;
  align?: "right" | "center";
  sortable?: boolean;
  /** nilai untuk sort & search (string/number). Tanpa ini kolom tak bisa di-sort/search. */
  accessor?: (row: T) => string | number | null;
  /** render sel; default = nilai accessor. */
  cell?: (row: T) => React.ReactNode;
  className?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<T>({
  columns,
  data,
  getKey,
  searchPlaceholder = "Cari…",
  pageSize = 10,
  empty = "Tidak ada data.",
}: {
  columns: DataColumn<T>[];
  data: T[];
  getKey: (row: T, i: number) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const searchable = columns.filter((c) => c.accessor);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      searchable.some((c) => String(c.accessor!(row) ?? "").toLowerCase().includes(term)),
    );
  }, [q, data, searchable]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.accessor) return filtered;
    const acc = col.accessor;
    const arr = [...filtered].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), "id");
    });
    return sort.dir === "desc" ? arr.reverse() : arr;
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const cur = Math.min(page, pageCount - 1);
  const rows = sorted.slice(cur * size, cur * size + size);

  function toggleSort(id: string) {
    setPage(0);
    setSort((s) => (s?.id === id ? (s.dir === "asc" ? { id, dir: "desc" } : null) : { id, dir: "asc" }));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="h-8 pl-8"
          />
        </div>
        <div className="text-muted-foreground text-xs whitespace-nowrap">{sorted.length} baris</div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <TableHead key={c.id} className={cn(c.align === "right" && "text-right", c.className)}>
                  {c.sortable && c.accessor ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-muted-foreground text-center">
                {q ? "Tidak ada hasil untuk pencarian ini." : empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={getKey(row, cur * size + i)}>
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn(c.align === "right" && "text-right", c.className)}>
                    {c.cell ? c.cell(row) : String(c.accessor?.(row) ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {sorted.length > PAGE_SIZES[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Baris/hal:</span>
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
              className="h-7 rounded-md border border-input bg-transparent px-1.5 text-sm outline-none"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              Hal {cur + 1}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={cur === 0}
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={cur >= pageCount - 1}
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
