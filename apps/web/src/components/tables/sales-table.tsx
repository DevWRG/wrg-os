"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

interface RankRow {
  key: string;
  label: string;
  sub?: string;
  total: number;
  count: number;
  target?: number;
}

const rupiahFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// Warna % pencapaian: hijau ≥100, kuning ≥60, merah <60.
const achColor = (pct: number) => (pct >= 100 ? "text-success" : pct >= 60 ? "text-warning" : "text-danger");

export function SalesTable({ rows, header, grandTotal, showTarget = false }: { rows: RankRow[]; header: string; grandTotal: number; showTarget?: boolean }) {
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
    ...(showTarget
      ? ([
          {
            id: "target",
            header: "Target (thn)",
            align: "right",
            sortable: true,
            accessor: (r: RankRow) => r.target ?? 0,
            cell: (r: RankRow) => <span className="text-muted-foreground">{r.target ? rupiahFull(r.target) : "—"}</span>,
          },
          {
            id: "achievement",
            header: "Capai",
            align: "right",
            sortable: true,
            accessor: (r: RankRow) => (r.target ? r.total / r.target : -1),
            cell: (r: RankRow) => {
              if (!r.target) return <span className="text-muted-foreground">—</span>;
              const pct = Math.round((r.total / r.target) * 100);
              return <span className={cn("font-medium", achColor(pct))}>{pct}%</span>;
            },
          },
        ] as DataColumn<RankRow>[])
      : []),
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
