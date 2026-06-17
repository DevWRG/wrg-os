"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface SalesOrder {
  id: string;
  number: string | null;
  trans_date: string | null;
  customer_name: string | null;
  status: string | null;
  total_amount: string | null;
}

const rupiah = (v: string | number | null) => {
  const n = v == null || v === "" ? null : Number(v);
  return n == null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
};

const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  if (!y || !m || !d) return v;
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${d} ${bln[Number(m) - 1] ?? m} ${y}`;
};

const statusTone = (s: string | null): "default" | "secondary" | "destructive" | "outline" => {
  const t = (s ?? "").toLowerCase();
  if (t.includes("batal") || t.includes("tutup")) return "destructive";
  if (t.includes("proses")) return "default";
  if (t.includes("kirim") || t.includes("selesai")) return "secondary";
  return "outline";
};

const columns: DataColumn<SalesOrder>[] = [
  { id: "number", header: "Order #", sortable: true, accessor: (o) => o.number ?? "", cell: (o) => <span className="font-medium whitespace-nowrap">{o.number ?? "—"}</span> },
  { id: "trans_date", header: "Tanggal", sortable: true, accessor: (o) => o.trans_date ?? "", cell: (o) => <span className="whitespace-nowrap">{tgl(o.trans_date)}</span>, className: "whitespace-nowrap" },
  { id: "customer", header: "Customer", sortable: true, accessor: (o) => o.customer_name ?? "", cell: (o) => <span className="block max-w-[20rem] truncate" title={o.customer_name ?? ""}>{o.customer_name ?? "—"}</span>, className: "max-w-[20rem]" },
  { id: "status", header: "Status", sortable: true, accessor: (o) => o.status ?? "", cell: (o) => (o.status ? <Badge variant={statusTone(o.status)}>{o.status}</Badge> : <span className="text-muted-foreground">—</span>) },
  { id: "total", header: "Total", align: "right", sortable: true, accessor: (o) => Number(o.total_amount) || 0, cell: (o) => <span className="whitespace-nowrap font-medium">{rupiah(o.total_amount)}</span>, className: "whitespace-nowrap" },
];

interface LineItem {
  no: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  total: number | null;
}

export function OrdersTable({ orders }: { orders: SalesOrder[] }) {
  const [sel, setSel] = useState<SalesOrder | null>(null);
  const [items, setItems] = useState<LineItem[] | null>(null);
  const [itemsErr, setItemsErr] = useState(false);

  function openDetail(o: SalesOrder) {
    setSel(o);
    setItems(null);
    setItemsErr(false);
    fetch(`/api/orders/${encodeURIComponent(o.id)}/items`)
      .then((r) => r.json())
      .then((d: { items?: LineItem[] }) => setItems(d.items ?? []))
      .catch(() => {
        setItems([]);
        setItemsErr(true);
      });
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={orders}
        getKey={(o) => o.id}
        searchPlaceholder="Cari order # / customer / status…"
        pageSize={25}
        onRowClick={openDetail}
      />

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sel && (
            <>
              <SheetHeader className="gap-2">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Sales Order</div>
                <SheetTitle className="font-mono text-sm leading-snug break-all">{sel.number ?? "—"}</SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <span>{tgl(sel.trans_date)}</span>
                  {sel.status && <Badge variant={statusTone(sel.status)} className="shrink-0">{sel.status}</Badge>}
                </SheetDescription>
              </SheetHeader>
              <dl className="px-4 pb-6 text-sm">
                <div className="border-t py-3">
                  <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">Customer</dt>
                  <dd className="font-medium break-words">{sel.customer_name ?? "—"}</dd>
                </div>
                <div className="border-t py-3">
                  <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">Total</dt>
                  <dd className="font-medium">{rupiah(sel.total_amount)}</dd>
                </div>
                <div className="border-t py-3">
                  <dt className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                    Produk
                    {items && items.length > 0 && <span className="text-muted-foreground/70 normal-case">({items.length})</span>}
                  </dt>
                  <dd>
                    {items === null ? (
                      <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                        <Loader2 className="size-3.5 animate-spin" /> Memuat produk…
                      </div>
                    ) : itemsErr ? (
                      <div className="text-muted-foreground py-1 text-xs">Gagal memuat produk.</div>
                    ) : items.length === 0 ? (
                      <div className="text-muted-foreground py-1 text-xs">Tidak ada baris produk.</div>
                    ) : (
                      <ul className="divide-border divide-y">
                        {items.map((it, i) => (
                          <li key={i} className="flex items-start justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <div className="break-words">{it.name ?? "—"}</div>
                              {it.no && <div className="text-muted-foreground font-mono text-xs">{it.no}</div>}
                            </div>
                            <div className="shrink-0 text-right whitespace-nowrap">
                              <div className="text-sm font-medium tabular-nums">
                                {it.quantity ?? "—"}
                                {it.unit && <span className="text-muted-foreground ml-1 text-xs font-normal">{it.unit}</span>}
                              </div>
                              {it.total != null && <div className="text-muted-foreground text-xs tabular-nums">{rupiah(it.total)}</div>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
