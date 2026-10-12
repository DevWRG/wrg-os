"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { TicketRowActions } from "@/components/crm/ticket-row-actions";

export interface ServiceTicket {
  id: string;
  customer_name: string | null;
  complaint_text: string;
  area: string | null;
  severity: string;
  eta_at: string | null;
  assigned_teknisi_name: string | null;
  needs_review: boolean;
  status: string;
  created_at: string;
}

const SEVERITY_LABEL: Record<string, string> = { rendah: "Rendah", sedang: "Sedang", tinggi: "Tinggi", kritis: "Kritis" };
const severityTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "kritis" ? "destructive" : s === "tinggi" ? "default" : s === "sedang" ? "secondary" : "outline";

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);
const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function ServiceTicketsTable({ tickets }: { tickets: ServiceTicket[] }) {
  const columns: DataColumn<ServiceTicket>[] = [
    {
      id: "customer",
      header: "Customer",
      sortable: true,
      accessor: (t) => t.customer_name ?? "",
      cell: (t) => (
        <div>
          <div className="font-medium">{t.customer_name ?? "—"}</div>
          <div className="text-muted-foreground text-xs" title={t.complaint_text}>{clip(t.complaint_text)}</div>
        </div>
      ),
    },
    { id: "area", header: "Area", accessor: (t) => t.area ?? "", cell: (t) => t.area ?? "—" },
    {
      id: "severity",
      header: "Severity",
      sortable: true,
      accessor: (t) => t.severity,
      cell: (t) => <Badge variant={severityTone(t.severity)}>{SEVERITY_LABEL[t.severity] ?? t.severity}</Badge>,
    },
    {
      id: "teknisi",
      header: "Teknisi",
      accessor: (t) => t.assigned_teknisi_name ?? "",
      cell: (t) => (t.assigned_teknisi_name ? t.assigned_teknisi_name : t.needs_review ? <Badge variant="outline">Perlu review</Badge> : "—"),
    },
    { id: "eta", header: "ETA", sortable: true, accessor: (t) => t.eta_at ?? "", cell: (t) => (t.eta_at ? <span className="whitespace-nowrap">{tgl(t.eta_at)}</span> : "—") },
    { id: "status", header: "Status", sortable: true, accessor: (t) => t.status, cell: (t) => <Badge variant={t.status === "resolved" ? "secondary" : "outline"}>{t.status}</Badge> },
    { id: "aksi", header: "Aksi", align: "right", cell: (t) => <TicketRowActions row={t} /> },
  ];

  return (
    <DataTable columns={columns} data={tickets} getKey={(t) => t.id} searchPlaceholder="Cari customer / komplain…" pageSize={25} />
  );
}
