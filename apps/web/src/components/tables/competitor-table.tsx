"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface CompetitorItem {
  id: string;
  am_id: string | null;
  customer_name: string | null;
  tanggal: string;
  vendor: string;
  produk: string | null;
  produk_kategori: string | null;
  harga_text: string | null;
  harga_numeric: number | null;
  konteks: string | null;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const harga = (i: CompetitorItem) => (i.harga_numeric !== null ? rupiah(i.harga_numeric) : (i.harga_text ?? "—"));

const columns: DataColumn<CompetitorItem>[] = [
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (i) => i.tanggal, cell: (i) => <span className="text-muted-foreground whitespace-nowrap">{tgl(i.tanggal)}</span>, className: "whitespace-nowrap" },
  { id: "vendor", header: "Kompetitor", sortable: true, accessor: (i) => i.vendor, cell: (i) => <span className="font-medium whitespace-nowrap">{i.vendor}</span> },
  {
    id: "produk",
    header: "Produk",
    sortable: true,
    accessor: (i) => i.produk ?? "",
    cell: (i) => (
      <div className="flex max-w-[15rem] items-center gap-2">
        <span className="truncate" title={i.produk ?? undefined}>{i.produk ?? "—"}</span>
        {i.produk_kategori && <Badge variant="outline" className="shrink-0">{i.produk_kategori}</Badge>}
      </div>
    ),
    className: "max-w-[15rem]",
  },
  { id: "harga", header: "Harga", align: "right", sortable: true, accessor: (i) => i.harga_numeric ?? 0, cell: (i) => <span className="whitespace-nowrap">{harga(i)}</span>, className: "whitespace-nowrap" },
  { id: "customer", header: "Customer", sortable: true, accessor: (i) => i.customer_name ?? "", cell: (i) => <span className="text-muted-foreground block max-w-[11rem] truncate" title={i.customer_name ?? undefined}>{i.customer_name ?? "—"}</span>, className: "max-w-[11rem]" },
  { id: "konteks", header: "Konteks", accessor: (i) => i.konteks ?? "", cell: (i) => <span className="text-muted-foreground block max-w-[18rem] truncate" title={i.konteks ?? undefined}>{i.konteks || "—"}</span>, className: "max-w-[18rem]" },
];

export function CompetitorTable({ items }: { items: CompetitorItem[] }) {
  const [sel, setSel] = useState<CompetitorItem | null>(null);
  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        getKey={(i) => i.id}
        searchPlaceholder="Cari vendor / produk / customer…"
        pageSize={25}
        onRowClick={(i) => setSel(i)}
      />

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {sel.vendor}
                  {sel.produk_kategori && <Badge variant="outline">{sel.produk_kategori}</Badge>}
                </SheetTitle>
                <SheetDescription>{tgl(sel.tanggal)}</SheetDescription>
              </SheetHeader>
              <dl className="space-y-3 px-4 pb-6 text-sm">
                <div><dt className="text-muted-foreground text-xs">Produk</dt><dd className="break-words">{sel.produk ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Customer</dt><dd className="break-words">{sel.customer_name ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Harga</dt><dd>{harga(sel)}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Konteks</dt><dd className="break-words whitespace-pre-wrap leading-relaxed">{sel.konteks ?? "—"}</dd></div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
