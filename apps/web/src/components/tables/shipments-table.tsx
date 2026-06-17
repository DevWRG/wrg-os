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

export interface DeliveryOrder {
  id: string;
  number: string | null;
  trans_date: string | null;
  customer_name: string | null;
  ship_to: string | null;
  status: string | null;
}

const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  if (!y || !m || !d) return v;
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${d} ${bln[Number(m) - 1] ?? m} ${y}`;
};

const statusTone = (s: string | null): "default" | "secondary" | "destructive" | "outline" => {
  const t = (s ?? "").toLowerCase();
  if (t.includes("batal") || t.includes("retur")) return "destructive";
  if (t.includes("kirim") || t.includes("transit")) return "default";
  if (t.includes("terima") || t.includes("selesai") || t.includes("sampai")) return "secondary";
  return "outline";
};

const columns: DataColumn<DeliveryOrder>[] = [
  { id: "number", header: "Surat Jalan #", sortable: true, accessor: (s) => s.number ?? "", cell: (s) => <span className="font-medium whitespace-nowrap">{s.number ?? "—"}</span> },
  { id: "trans_date", header: "Tanggal", sortable: true, accessor: (s) => s.trans_date ?? "", cell: (s) => <span className="whitespace-nowrap">{tgl(s.trans_date)}</span>, className: "whitespace-nowrap" },
  { id: "customer", header: "Customer", sortable: true, accessor: (s) => s.customer_name ?? "", cell: (s) => <span className="block max-w-[20rem] truncate" title={s.customer_name ?? ""}>{s.customer_name ?? "—"}</span>, className: "max-w-[20rem]" },
  { id: "status", header: "Status", sortable: true, accessor: (s) => s.status ?? "", cell: (s) => (s.status ? <Badge variant={statusTone(s.status)}>{s.status}</Badge> : <span className="text-muted-foreground">—</span>) },
];

export function ShipmentsTable({ shipments }: { shipments: DeliveryOrder[] }) {
  const [sel, setSel] = useState<DeliveryOrder | null>(null);
  return (
    <>
      <DataTable
        columns={columns}
        data={shipments}
        getKey={(s) => s.id}
        searchPlaceholder="Cari surat jalan / customer / status…"
        pageSize={25}
        onRowClick={(s) => setSel(s)}
      />

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sel && (
            <>
              <SheetHeader className="gap-2">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Surat Jalan</div>
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
                  <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">Tujuan</dt>
                  <dd className="break-words whitespace-pre-wrap leading-relaxed">{sel.ship_to ?? "—"}</dd>
                </div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
