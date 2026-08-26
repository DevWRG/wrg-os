"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, SearchX, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
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

/**
 * Mode server-driven: search, sort, dan paginasi dikerjakan backend, komponen
 * ini cuma merender `data` apa adanya sebagai SATU halaman.
 *
 * Ada karena mode bawaan (client-side atas seluruh array) diam-diam berbohong
 * begitu backend membatasi jumlah baris: tabel /visits menerima 1000 baris
 * teratas lalu menulis "1000 baris" di footer, padahal datanya 1961 — dan
 * search/filter-nya hanya menyaring 1000 itu. Tanda bahwa tabel butuh mode ini:
 * pemanggilnya mengirim `limit` ke backend dan hasilnya bisa terpotong.
 *
 * Opsional; tanpa prop `server` perilaku lama tak berubah sama sekali.
 */
export interface DataTableServer {
  /** Jumlah baris yang cocok filter di backend — bukan yang ada di `data`. */
  totalRows: number;
  /** Halaman aktif, berbasis 0. */
  page: number;
  pageSize: number;
  sort: { id: string; dir: "asc" | "desc" } | null;
  q: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sort: { id: string; dir: "asc" | "desc" } | null) => void;
  onSearchChange: (q: string) => void;
  /** true saat halaman berikutnya sedang diambil — tabel diredupkan. */
  pending?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  getKey,
  searchPlaceholder = "Cari…",
  pageSize = 10,
  empty = "Tidak ada data.",
  toolbar,
  onRowClick,
  initialSort,
  server,
}: {
  columns: DataColumn<T>[];
  data: T[];
  getKey: (row: T, i: number) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: string;
  /** kontrol tambahan (mis. filter date-range) di sisi kanan baris search. */
  toolbar?: React.ReactNode;
  /** klik baris → mis. navigasi ke detail. Baris jadi cursor-pointer. */
  onRowClick?: (row: T) => void;
  /** sort awal saat tabel pertama dirender (mis. {id:"total",dir:"desc"} = top Revenue). */
  initialSort?: { id: string; dir: "asc" | "desc" };
  /** aktifkan mode server-driven (lihat DataTableServer). */
  server?: DataTableServer;
}) {
  const [qLocal, setQLocal] = useState("");
  const [sortLocal, setSortLocal] = useState<{ id: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [sizeLocal, setSizeLocal] = useState(pageSize);

  // Di mode server, state-nya milik pemanggil (biasanya URL); di mode lama
  // milik komponen ini. Selebihnya render-nya identik.
  const q = server ? server.q : qLocal;
  const sort = server ? server.sort : sortLocal;
  const size = server ? server.pageSize : sizeLocal;

  const searchable = columns.filter((c) => c.accessor);

  const filtered = useMemo(() => {
    if (server) return data;
    const term = q.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      searchable.some((c) => String(c.accessor!(row) ?? "").toLowerCase().includes(term)),
    );
  }, [q, data, searchable, server]);

  const sorted = useMemo(() => {
    if (server || !sort) return filtered;
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
  }, [filtered, sort, columns, server]);

  const totalRows = server ? server.totalRows : sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / size));
  const cur = server ? Math.min(server.page, pageCount - 1) : Math.min(page, pageCount - 1);
  const rows = server ? data : sorted.slice(cur * size, cur * size + size);

  const gotoPage = (p: number) => (server ? server.onPageChange(p) : setPage(p));
  const setSize = (n: number) => {
    if (server) server.onPageSizeChange(n);
    else setSizeLocal(n);
  };
  const setQ = (v: string) => {
    if (server) server.onSearchChange(v);
    else setQLocal(v);
  };

  function toggleSort(id: string) {
    // Siklus tetap sama: asc → desc → tanpa sort.
    const next: { id: string; dir: "asc" | "desc" } | null =
      sort?.id === id ? (sort.dir === "asc" ? { id, dir: "desc" } : null) : { id, dir: "asc" };
    if (server) server.onSortChange(next);
    else {
      setPage(0);
      setSortLocal(next);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs min-w-[180px]">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!server) setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="h-8 pl-8 bg-card border-border"
          />
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
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
        <TableBody className={cn(server?.pending && "opacity-50 transition-opacity")}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                {q ? (
                  <EmptyState icon={SearchX} title="Tidak ada hasil" description={`Tak ada baris cocok untuk "${q}".`} />
                ) : (
                  <EmptyState title={empty} />
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow
                key={getKey(row, cur * size + i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
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

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {/* Di mode server ini jumlah baris yang COCOK FILTER, bukan yang sedang
            dirender — footer lama menulis panjang array dan itulah yang bikin
            tabel tampak cuma punya 1000 baris padahal datanya 1961. */}
        <span className="text-muted-foreground text-xs">{totalRows} baris</span>
        {totalRows > PAGE_SIZES[0] && (
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Baris/hal:</span>
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                if (!server) setPage(0);
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
              onClick={() => gotoPage(Math.max(0, cur - 1))}
              disabled={cur === 0}
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => gotoPage(Math.min(pageCount - 1, cur + 1))}
              disabled={cur >= pageCount - 1}
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
            >
              Next
            </button>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
