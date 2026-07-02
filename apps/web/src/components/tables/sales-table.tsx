"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface RankRow {
  key: string;
  label: string;
  sub?: string;
  total: number;
  count: number;
}

const rupiahFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export function SalesTable({ rows, header, grandTotal }: { rows: RankRow[]; header: string; grandTotal: number }) {
  const columns: DataColumn<RankRow>[] = [
    {
      id: "label",
      header,
      sortable: true,
      accessor: (r) => r.label,
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-medium">{r.label}</span>
          {r.sub && <div className="text-muted-foreground text-xs">{r.sub}</div>}
        </div>
      ),
    },
    { id: "count", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.count },
    { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => <span className="font-medium">{rupiahFull(r.total)}</span> },
    {
      id: "share",
      header: "Share",
      align: "right",
      sortable: true,
      accessor: (r) => r.total,
      cell: (r) => <span className="text-muted-foreground">{grandTotal > 0 ? `${Math.round((r.total / grandTotal) * 100)}%` : "—"}</span>,
    },
  ];
  return <DataTable columns={columns} data={rows} getKey={(r) => r.key} searchPlaceholder={`Cari ${header.toLowerCase()}…`} pageSize={25} initialSort={{ id: "total", dir: "desc" }} />;
}
