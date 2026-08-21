"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface AtkStockLevelRow {
  item_id: string;
  item_name: string;
  unit: string;
  category_name: string | null;
  min_stock: number | null;
  is_active: boolean;
  stock_in: number;
  stock_out: number;
  current_stock: number;
  is_low_stock: boolean;
}

export function AtkStockLevelTable({ rows }: { rows: AtkStockLevelRow[] }) {
  const columns: DataColumn<AtkStockLevelRow>[] = [
    { id: "name", header: "Nama", sortable: true, accessor: (r) => r.item_name, cell: (r) => <span className="font-medium">{r.item_name}</span> },
    { id: "cat", header: "Kategori", sortable: true, accessor: (r) => r.category_name ?? "", cell: (r) => r.category_name ?? "—" },
    { id: "unit", header: "Satuan", sortable: true, accessor: (r) => r.unit, cell: (r) => r.unit },
    { id: "in", header: "Stok Masuk", align: "right", sortable: true, accessor: (r) => r.stock_in, cell: (r) => r.stock_in },
    { id: "out", header: "Stok Keluar", align: "right", sortable: true, accessor: (r) => r.stock_out, cell: (r) => r.stock_out },
    {
      id: "current",
      header: "Stok Saat Ini",
      align: "right",
      sortable: true,
      accessor: (r) => r.current_stock,
      cell: (r) => <span className="font-medium">{r.current_stock}</span>,
    },
    { id: "minstock", header: "Min. Stok", align: "right", sortable: true, accessor: (r) => r.min_stock ?? 0, cell: (r) => (r.min_stock != null ? r.min_stock : "—") },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex gap-1">
          {r.is_low_stock && <Badge variant="destructive">Stok Rendah</Badge>}
          {!r.is_active && <Badge variant="secondary">Nonaktif</Badge>}
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} data={rows} getKey={(r) => r.item_id} searchPlaceholder="Cari barang…" pageSize={25} />;
}
