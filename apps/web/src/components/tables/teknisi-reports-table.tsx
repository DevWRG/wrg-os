"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface TeknisiReport {
  id: string;
  teknisi_nama: string | null;
  report_type: string;
  body: string;
  source: string;
  created_at: string;
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);
const waktu = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function TeknisiReportsTable({ reports }: { reports: TeknisiReport[] }) {
  const columns: DataColumn<TeknisiReport>[] = [
    { id: "teknisi", header: "Teknisi", sortable: true, accessor: (r) => r.teknisi_nama ?? "", cell: (r) => r.teknisi_nama ?? "—" },
    { id: "jenis", header: "Jenis", sortable: true, accessor: (r) => r.report_type, cell: (r) => <Badge variant="outline">#{r.report_type}</Badge> },
    { id: "isi", header: "Isi", accessor: (r) => r.body, cell: (r) => <span title={r.body}>{clip(r.body)}</span> },
    { id: "sumber", header: "Sumber", sortable: true, accessor: (r) => r.source, cell: (r) => <Badge variant={r.source === "wa" ? "secondary" : "outline"}>{r.source}</Badge> },
    { id: "waktu", header: "Waktu", sortable: true, accessor: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap">{waktu(r.created_at)}</span> },
  ];

  return <DataTable columns={columns} data={reports} getKey={(r) => r.id} searchPlaceholder="Cari isi laporan…" pageSize={25} />;
}
