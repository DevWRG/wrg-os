"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ItTicketRowActions } from "@/components/crm/it-ticket-row-actions";

export interface ItTicket {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  is_critical: boolean;
  masalah: string;
  status: string;
  reported_by: string | null;
  assigned_to: string | null;
  sla_due_at: string;
  sla_overdue: boolean;
  resolved_at: string | null;
}

const STATUS_LABEL: Record<string, string> = { open: "Baru", in_progress: "Dikerjakan", resolved: "Selesai" };
const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "resolved" ? "outline" : s === "in_progress" ? "secondary" : "destructive";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ItTicketsTable({ tickets }: { tickets: ItTicket[] }) {
  const columns: DataColumn<ItTicket>[] = [
    {
      id: "aset",
      header: "Aset",
      sortable: true,
      accessor: (t) => t.asset_code,
      cell: (t) => (
        <div>
          <div className="font-medium">
            {t.asset_code}
            {t.is_critical && <Badge variant="destructive" className="ml-1.5">Kritis</Badge>}
          </div>
          <div className="text-muted-foreground text-xs">{t.asset_nama}</div>
        </div>
      ),
    },
    { id: "masalah", header: "Masalah", cell: (t) => <span className="line-clamp-2">{t.masalah}</span> },
    { id: "pic", header: "PIC", cell: (t) => t.assigned_to ?? <span className="text-muted-foreground text-xs">belum ditugaskan</span> },
    {
      id: "status",
      header: "Status",
      cell: (t) => <Badge variant={statusTone(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Badge>,
    },
    {
      id: "sla",
      header: "SLA",
      cell: (t) =>
        t.status === "resolved" ? (
          <span className="text-muted-foreground text-xs">selesai {t.resolved_at ? fmtDateTime(t.resolved_at) : ""}</span>
        ) : t.sla_overdue ? (
          <Badge variant="destructive">Lewat SLA ({fmtDateTime(t.sla_due_at)})</Badge>
        ) : (
          <span className="text-xs">batas {fmtDateTime(t.sla_due_at)}</span>
        ),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (t) => <ItTicketRowActions ticket={t} /> },
  ];

  return (
    <DataTable columns={columns} data={tickets} getKey={(t) => t.id} searchPlaceholder="Cari aset / masalah…" pageSize={25} />
  );
}
