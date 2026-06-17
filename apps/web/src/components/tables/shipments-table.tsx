"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

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

const oneLine = (v: string | null) => (v ? v.replace(/\s*\n\s*/g, ", ").trim() : "");

const columns: DataColumn<DeliveryOrder>[] = [
  { id: "number", header: "Surat Jalan #", sortable: true, accessor: (s) => s.number ?? "", cell: (s) => <span className="font-medium whitespace-nowrap">{s.number ?? "—"}</span> },
  { id: "trans_date", header: "Tanggal", sortable: true, accessor: (s) => s.trans_date ?? "", cell: (s) => <span className="whitespace-nowrap">{tgl(s.trans_date)}</span>, className: "whitespace-nowrap" },
  { id: "customer", header: "Customer", sortable: true, accessor: (s) => s.customer_name ?? "", cell: (s) => <span className="block max-w-[22rem] truncate" title={s.customer_name ?? ""}>{s.customer_name ?? "—"}</span>, className: "max-w-[22rem]" },
  { id: "ship_to", header: "Tujuan", sortable: false, accessor: (s) => oneLine(s.ship_to), cell: (s) => <span className="block max-w-[24rem] truncate text-muted-foreground" title={oneLine(s.ship_to)}>{oneLine(s.ship_to) || "—"}</span>, className: "max-w-[24rem]" },
  { id: "status", header: "Status", sortable: true, accessor: (s) => s.status ?? "", cell: (s) => (s.status ? <Badge variant={statusTone(s.status)}>{s.status}</Badge> : <span className="text-muted-foreground">—</span>) },
];

export function ShipmentsTable({ shipments }: { shipments: DeliveryOrder[] }) {
  return <DataTable columns={columns} data={shipments} getKey={(s) => s.id} searchPlaceholder="Cari surat jalan / customer / status…" pageSize={25} />;
}
