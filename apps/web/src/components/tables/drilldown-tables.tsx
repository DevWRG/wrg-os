"use client";

import { MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface PlanRow {
  tanggal: string;
  customer_name: string | null;
  tujuan: string | null;
  goal: string | null;
  reported: boolean;
  is_late_plan: boolean;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date_mismatch: boolean;
  hasil: string | null;
  next_action: string | null;
}
interface UnmatchedRow {
  tanggal: string;
  customer_name: string | null;
  hasil: string | null;
  next_action: string | null;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const clip = (s: string, n = 44) => (s.length > n ? `${s.slice(0, n)}…` : s);

const planColumns: DataColumn<PlanRow>[] = [
  { id: "tanggal", header: "Tgl", sortable: true, accessor: (p) => p.tanggal, cell: (p) => <span className="text-muted-foreground whitespace-nowrap">{tgl(p.tanggal)}</span> },
  { id: "customer", header: "Customer", sortable: true, accessor: (p) => p.customer_name ?? "", cell: (p) => <span className="font-medium">{p.customer_name ?? "—"}</span> },
  { id: "tujuan", header: "Tujuan", accessor: (p) => p.tujuan ?? p.goal ?? "", cell: (p) => { const t = p.tujuan ?? p.goal; return <span className="text-muted-foreground" title={t ?? undefined}>{t ? clip(t) : "—"}</span>; } },
  {
    id: "status",
    header: "Status",
    sortable: true,
    accessor: (p) => (p.reported ? "reported" : p.is_late_plan ? "late" : "pending"),
    cell: (p) =>
      p.reported ? <Badge variant="secondary">reported</Badge> : p.is_late_plan ? <Badge variant="destructive">late</Badge> : <Badge variant="outline">pending</Badge>,
  },
  { id: "hasil", header: "Hasil", accessor: (p) => p.hasil ?? "", cell: (p) => <span className="text-muted-foreground block max-w-[32rem] whitespace-pre-wrap break-words">{p.hasil ?? "—"}</span> },
  {
    id: "geo",
    header: "Geotag",
    cell: (p) => (
      <>
        {p.visit_lat !== null && p.visit_lon !== null ? (
          <a href={`https://www.google.com/maps?q=${p.visit_lat},${p.visit_lon}`} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline underline-offset-2">
            <MapPin className="size-3" /> peta
          </a>
        ) : p.reported ? (
          <span className="text-warning text-xs">⚠ no geotag</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {p.visit_date_mismatch && <Badge variant="destructive" className="ml-1">tgl mismatch</Badge>}
      </>
    ),
  },
];

export function DrilldownPlanTable({ plan }: { plan: PlanRow[] }) {
  return <DataTable columns={planColumns} data={plan} getKey={(_, i) => String(i)} searchPlaceholder="Cari customer…" pageSize={25} />;
}

const unmatchedColumns: DataColumn<UnmatchedRow>[] = [
  { id: "tanggal", header: "Tgl", sortable: true, accessor: (a) => a.tanggal, cell: (a) => <span className="text-muted-foreground whitespace-nowrap">{tgl(a.tanggal)}</span> },
  { id: "customer", header: "Customer", sortable: true, accessor: (a) => a.customer_name ?? "", cell: (a) => a.customer_name ?? "—" },
  { id: "hasil", header: "Hasil", accessor: (a) => a.hasil ?? "", cell: (a) => <span className="text-muted-foreground block max-w-[32rem] whitespace-pre-wrap break-words">{a.hasil ?? "—"}</span> },
  { id: "next", header: "Next", accessor: (a) => a.next_action ?? "", cell: (a) => <span className="text-muted-foreground block max-w-[24rem] whitespace-pre-wrap break-words">{a.next_action ?? "—"}</span> },
];

export function DrilldownUnmatchedTable({ rows }: { rows: UnmatchedRow[] }) {
  return <DataTable columns={unmatchedColumns} data={rows} getKey={(_, i) => String(i)} searchPlaceholder="Cari…" pageSize={25} />;
}
