"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangeToolbar } from "@/components/ui/date-range-toolbar";
import { useTableUrl } from "@/lib/use-table-url";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

interface LineItem {
  no: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
}

function Field({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export interface ShipmentsQuery {
  q: string;
  from: string;
  to: string;
  /** id kolom = MIRROR_SORTS di apps/api repo/accurateMirror.ts. */
  sort: string;
  dir: "asc" | "desc";
  page: number;
  size: number;
}

export function ShipmentsTable({
  shipments,
  totalRows,
  query,
}: {
  shipments: DeliveryOrder[];
  /** jumlah surat jalan yang COCOK FILTER di backend, bukan panjang `shipments`. */
  totalRows: number;
  query: ShipmentsQuery;
}) {
  const { push, qInput, setQInput, pending } = useTableUrl(query.q);
  const [sel, setSel] = useState<DeliveryOrder | null>(null);
  const [items, setItems] = useState<LineItem[] | null>(null);
  const [itemsErr, setItemsErr] = useState(false);

  function openDetail(s: DeliveryOrder) {
    setSel(s);
    setItems(null);
    setItemsErr(false);
    fetch(`/api/shipments/${encodeURIComponent(s.id)}/items`)
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
        data={shipments}
        getKey={(s) => s.id}
        searchPlaceholder="Cari surat jalan / customer / status…"
        onRowClick={openDetail}
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
            idPrefix="sj"
          />
        }
      />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Surat Jalan</div>
                <DialogTitle className="font-mono text-sm leading-snug break-all">{sel.number ?? "—"}</DialogTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{tgl(sel.trans_date)}</span>
                  {sel.status && <Badge variant={statusTone(sel.status)} className="shrink-0">{sel.status}</Badge>}
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Customer" value={<span className="font-medium break-words">{sel.customer_name ?? "—"}</span>} />
                  <Field label="Tujuan" value={<span className="break-words whitespace-pre-wrap leading-relaxed">{sel.ship_to ?? "—"}</span>} />
                </div>
                <div>
                  <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                    Produk
                    {items && items.length > 0 && <span className="text-muted-foreground/70 normal-case">({items.length})</span>}
                  </div>
                  {items === null ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                      <Loader2 className="size-3.5 animate-spin" /> Memuat produk…
                    </div>
                  ) : itemsErr ? (
                    <div className="text-muted-foreground py-1 text-xs">Gagal memuat produk.</div>
                  ) : items.length === 0 ? (
                    <div className="text-muted-foreground py-1 text-xs">Tidak ada baris produk.</div>
                  ) : (
                    <ul className="divide-border divide-y rounded-lg border">
                      {items.map((it, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="break-words">{it.name ?? "—"}</div>
                            {it.no && <div className="text-muted-foreground font-mono text-xs">{it.no}</div>}
                          </div>
                          <div className="shrink-0 text-right text-sm font-medium whitespace-nowrap tabular-nums">
                            {it.quantity ?? "—"}
                            {it.unit && <span className="text-muted-foreground ml-1 text-xs font-normal">{it.unit}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DialogBody>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
