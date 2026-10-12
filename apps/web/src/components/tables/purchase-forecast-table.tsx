"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { PurchaseForecastRowActions } from "@/components/crm/purchase-forecast-row-actions";
import { formatRupiah } from "@/lib/pricelist";

export interface PurchaseForecast {
  id: string;
  period_year: number;
  period_month: number;
  lini: "IVD" | "Medical" | null;
  forecast_value: number;
  forecast_qty: number | null;
  notes: string | null;
  actual_value: number;
  actual_qty: number;
  gap_value: number;
  gap_qty: number | null;
  gap_percent: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const periode = (f: PurchaseForecast) => `${MONTHS[f.period_month - 1]} ${f.period_year}`;

function GapBadge({ gap }: { gap: number }) {
  if (gap === 0) return <Badge variant="outline">Sesuai</Badge>;
  const over = gap > 0;
  return (
    <Badge className={over ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}>
      {over ? "Over" : "Under"} {formatRupiah(Math.abs(gap))}
    </Badge>
  );
}

const columns: DataColumn<PurchaseForecast>[] = [
  { id: "periode", header: "Periode", sortable: true, accessor: (f) => f.period_year * 100 + f.period_month, cell: (f) => <span className="font-medium whitespace-nowrap">{periode(f)}</span> },
  { id: "lini", header: "Lini", sortable: true, accessor: (f) => f.lini ?? "Seluruh lini", cell: (f) => (f.lini ? <Badge variant="outline">{f.lini}</Badge> : <span className="text-muted-foreground">Seluruh lini</span>) },
  { id: "forecast", header: "Forecast", align: "right", sortable: true, accessor: (f) => f.forecast_value, cell: (f) => formatRupiah(f.forecast_value) },
  { id: "actual", header: "Actual", align: "right", sortable: true, accessor: (f) => f.actual_value, cell: (f) => formatRupiah(f.actual_value) },
  { id: "gap", header: "Gap", align: "right", sortable: true, accessor: (f) => f.gap_value, cell: (f) => <GapBadge gap={f.gap_value} /> },
  {
    id: "gap_percent",
    header: "Gap %",
    align: "right",
    sortable: true,
    accessor: (f) => f.gap_percent,
    cell: (f) => (f.gap_percent == null ? <span className="text-muted-foreground">—</span> : `${f.gap_percent >= 0 ? "+" : ""}${f.gap_percent.toFixed(1)}%`),
  },
  { id: "notes", header: "Catatan", cell: (f) => f.notes ?? <span className="text-muted-foreground">—</span> },
  {
    id: "aksi",
    header: "Aksi",
    align: "right",
    cell: (f) => (
      <PurchaseForecastRowActions
        id={f.id}
        period_year={f.period_year}
        period_month={f.period_month}
        lini={f.lini}
        forecast_value={f.forecast_value}
        forecast_qty={f.forecast_qty}
        notes={f.notes}
      />
    ),
  },
];

export function PurchaseForecastTable({ rows }: { rows: PurchaseForecast[] }) {
  return <DataTable columns={columns} data={rows} getKey={(f) => f.id} searchPlaceholder="Cari periode/lini…" pageSize={25} />;
}
