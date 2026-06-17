"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface SalesOrder {
  id: string;
  number: string | null;
  trans_date: string | null;
  customer_name: string | null;
  status: string | null;
  total_amount: string | null;
}

const rupiah = (v: string | null) => {
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

export function OrdersTable({ orders }: { orders: SalesOrder[] }) {
  return <DataTable columns={columns} data={orders} getKey={(o) => o.id} searchPlaceholder="Cari order # / customer / status…" pageSize={25} />;
}
