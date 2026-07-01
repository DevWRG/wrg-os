"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { deriveRow, formatPercent, formatRupiah, num, type PricelistRow } from "@/lib/pricelist";

// View AM (read-only): identitas produk + 4 kolom harga terpublikasi.
const columns: DataColumn<PricelistRow>[] = [
  {
    id: "no",
    header: "SKU",
    sortable: true,
    accessor: (r) => r.product_no ?? "",
    cell: (r) => <span className="font-medium whitespace-nowrap">{r.product_no ?? "—"}</span>,
  },
  {
    id: "name",
    header: "Nama Produk",
    sortable: true,
    accessor: (r) => r.product_name ?? "",
    cell: (r) => (
      <span className="block max-w-[28rem] truncate" title={r.product_name ?? ""}>
        {r.product_name ?? "—"}
      </span>
    ),
    className: "max-w-[28rem]",
  },
  {
    id: "price_list",
    header: "Price List",
    align: "right",
    sortable: true,
    accessor: (r) => deriveRow(r).priceList,
    cell: (r) => <span className="whitespace-nowrap">{formatRupiah(deriveRow(r).priceList)}</span>,
  },
  {
    id: "diskon",
    header: "Diskon",
    align: "right",
    sortable: true,
    accessor: (r) => num(r.diskon_pct),
    cell: (r) => <span className="whitespace-nowrap">{formatPercent(num(r.diskon_pct))}</span>,
  },
  {
    id: "nett",
    header: "Nett Price",
    align: "right",
    sortable: true,
    accessor: (r) => deriveRow(r).nettPrice,
    cell: (r) => <span className="whitespace-nowrap">{formatRupiah(deriveRow(r).nettPrice)}</span>,
  },
  {
    id: "ppn",
    header: "Price + PPN",
    align: "right",
    sortable: true,
    accessor: (r) => deriveRow(r).pricePpn,
    cell: (r) => <span className="font-medium whitespace-nowrap">{formatRupiah(deriveRow(r).pricePpn)}</span>,
  },
];

export function AmPricelistTable({ rows }: { rows: PricelistRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      getKey={(r) => r.id}
      searchPlaceholder="Cari SKU / nama produk…"
      pageSize={25}
    />
  );
}
