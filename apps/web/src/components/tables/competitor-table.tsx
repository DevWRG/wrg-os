"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

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
const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n)}…` : s);

const columns: DataColumn<CompetitorItem>[] = [
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (i) => i.tanggal, cell: (i) => <span className="text-muted-foreground">{tgl(i.tanggal)}</span> },
  { id: "vendor", header: "Kompetitor", sortable: true, accessor: (i) => i.vendor, cell: (i) => <span className="font-medium">{i.vendor}</span> },
  {
    id: "produk",
    header: "Produk",
    sortable: true,
    accessor: (i) => i.produk ?? "",
    cell: (i) => (
      <>
        {i.produk ?? "—"}
        {i.produk_kategori && <Badge variant="outline" className="ml-2">{i.produk_kategori}</Badge>}
      </>
    ),
  },
  {
    id: "harga",
    header: "Harga",
    align: "right",
    sortable: true,
    accessor: (i) => i.harga_numeric ?? 0,
    cell: (i) => (i.harga_numeric !== null ? rupiah(i.harga_numeric) : (i.harga_text ?? "—")),
  },
  { id: "customer", header: "Customer", sortable: true, accessor: (i) => i.customer_name ?? "", cell: (i) => <span className="text-muted-foreground">{i.customer_name ?? "—"}</span> },
  { id: "konteks", header: "Konteks", accessor: (i) => i.konteks ?? "", cell: (i) => <span className="text-muted-foreground" title={i.konteks ?? undefined}>{i.konteks ? clip(i.konteks) : "—"}</span> },
];

export function CompetitorTable({ items }: { items: CompetitorItem[] }) {
  return <DataTable columns={columns} data={items} getKey={(i) => i.id} searchPlaceholder="Cari vendor / produk / customer…" pageSize={25} />;
}
