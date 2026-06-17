"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface AccurateItem {
  id: string;
  no: string;
  name: string;
  category: string | null;
  unit_price: string | null;
}

const rupiah = (v: string | null) => {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
};

const columns: DataColumn<AccurateItem>[] = [
  { id: "no", header: "SKU", sortable: true, accessor: (i) => i.no, cell: (i) => <span className="font-medium whitespace-nowrap">{i.no}</span> },
  { id: "name", header: "Nama Produk", sortable: true, accessor: (i) => i.name, cell: (i) => <span className="block max-w-[28rem] truncate" title={i.name}>{i.name}</span>, className: "max-w-[28rem]" },
  { id: "category", header: "Kategori", sortable: true, accessor: (i) => i.category ?? "", cell: (i) => i.category ? <Badge variant={i.category === "INVENTORY" ? "secondary" : "outline"}>{i.category}</Badge> : <span className="text-muted-foreground">—</span> },
  { id: "harga", header: "Harga", align: "right", sortable: true, accessor: (i) => Number(i.unit_price) || 0, cell: (i) => <span className="whitespace-nowrap">{rupiah(i.unit_price)}</span>, className: "whitespace-nowrap" },
];

export function ProductsTable({ items }: { items: AccurateItem[] }) {
  return <DataTable columns={columns} data={items} getKey={(i) => i.id} searchPlaceholder="Cari SKU / nama produk…" pageSize={25} />;
}
