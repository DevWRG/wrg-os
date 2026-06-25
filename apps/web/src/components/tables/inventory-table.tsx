"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface InventoryItem {
  id: string;
  no: string;
  name: string;
  category: string | null;
  unit_price: string | null;
  quantity: string | null;
  available: string | null;
  unit: string | null;
}

const num = (v: string | null) => (v == null || v === "" ? null : Number(v));
// Angka stok dgn pemisah ribuan id-ID (mis. 22712 → "22.712").
const fmtNum = (v: string | null) => {
  const n = num(v);
  return n == null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("id-ID").format(n);
};
const rupiah = (v: string | null) => {
  const n = num(v);
  return n == null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
};
const stok = (i: InventoryItem) => {
  const q = num(i.quantity);
  if (q == null) return <Badge variant="outline">—</Badge>;
  if (q <= 0) return <Badge variant="destructive">Habis</Badge>;
  if (q <= 5) return <Badge variant="outline">Menipis</Badge>;
  return <Badge variant="secondary">Tersedia</Badge>;
};

const columns: DataColumn<InventoryItem>[] = [
  { id: "no", header: "SKU", sortable: true, accessor: (i) => i.no, cell: (i) => <span className="font-medium whitespace-nowrap">{i.no}</span> },
  { id: "name", header: "Nama", sortable: true, accessor: (i) => i.name, cell: (i) => <span className="block max-w-[26rem] truncate" title={i.name}>{i.name}</span>, className: "max-w-[26rem]" },
  { id: "category", header: "Tipe", sortable: true, accessor: (i) => i.category ?? "", cell: (i) => i.category ? <Badge variant="outline">{i.category}</Badge> : <span className="text-muted-foreground">—</span> },
  { id: "quantity", header: "Stok", align: "right", sortable: true, accessor: (i) => num(i.quantity) ?? -1, cell: (i) => <span className="whitespace-nowrap font-medium">{fmtNum(i.quantity)}</span>, className: "whitespace-nowrap" },
  { id: "available", header: "Tersedia", align: "right", sortable: true, accessor: (i) => num(i.available) ?? -1, cell: (i) => <span className="whitespace-nowrap">{fmtNum(i.available)}</span>, className: "whitespace-nowrap" },
  { id: "unit", header: "Satuan", sortable: true, accessor: (i) => i.unit ?? "", cell: (i) => i.unit ? <span className="whitespace-nowrap">{i.unit}</span> : <span className="text-muted-foreground">—</span>, className: "whitespace-nowrap" },
  { id: "harga", header: "Harga", align: "right", sortable: true, accessor: (i) => num(i.unit_price) ?? 0, cell: (i) => <span className="whitespace-nowrap">{rupiah(i.unit_price)}</span>, className: "whitespace-nowrap" },
  { id: "status", header: "Status", sortable: true, accessor: (i) => num(i.quantity) ?? -1, cell: stok },
];

export function InventoryTable({ items }: { items: InventoryItem[] }) {
  return <DataTable columns={columns} data={items} getKey={(i) => i.id} searchPlaceholder="Cari SKU / nama item…" pageSize={25} />;
}
