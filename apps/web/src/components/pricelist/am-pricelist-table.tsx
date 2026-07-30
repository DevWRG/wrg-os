"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { formatPercent, formatRupiah, type AmPricelistRow } from "@/lib/pricelist";

// View AM (read-only): identitas produk + 4 kolom harga terpublikasi.
//
// Barisnya `AmPricelistRow`, BUKAN `PricelistRow` utuh — dan itu disengaja. Dulu
// komponen ini menerima baris mentah lalu memanggil deriveRow() di BROWSER, jadi
// `hpp` & `margin_pct` ikut terkirim ke klien (terbaca di view-source / tab Network)
// padahal tak ada kolom yang menampilkannya. HANDOVER §1/§9 melarang HPP & margin
// keluar ke sales, jadi turunannya sekarang dihitung di server (lib/pricelist.ts →
// toAmRow) dan yang sampai ke sini hanya angka yang boleh dibaca.
const columns: DataColumn<AmPricelistRow>[] = [
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
    accessor: (r) => r.priceList,
    cell: (r) => <span className="whitespace-nowrap">{formatRupiah(r.priceList)}</span>,
  },
  {
    id: "diskon",
    header: "Diskon",
    align: "right",
    sortable: true,
    accessor: (r) => r.diskonPct,
    cell: (r) => <span className="whitespace-nowrap">{formatPercent(r.diskonPct)}</span>,
  },
  {
    id: "nett",
    header: "Nett Price",
    align: "right",
    sortable: true,
    accessor: (r) => r.nettPrice,
    cell: (r) => <span className="whitespace-nowrap">{formatRupiah(r.nettPrice)}</span>,
  },
  {
    id: "ppn",
    header: "Price + PPN",
    align: "right",
    sortable: true,
    accessor: (r) => r.pricePpn,
    cell: (r) => <span className="font-medium whitespace-nowrap">{formatRupiah(r.pricePpn)}</span>,
  },
];

export function AmPricelistTable({ rows }: { rows: AmPricelistRow[] }) {
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
