"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaTicketAssignButton } from "@/components/crm/ga-ticket-assign-button";
import { GaTicketTransitionActions } from "@/components/crm/ga-ticket-transition-actions";
import { GaTicketTimelineButton } from "@/components/crm/ga-ticket-timeline-button";
import type { AppUserOption } from "@/components/crm/add-ga-ticket-button";

export interface GaTicket {
  id: string;
  ticket_no: string;
  title: string;
  category_nama: string;
  category_icon: string | null;
  priority: string;
  reporter_name: string | null;
  assignee_name: string | null;
  location: string | null;
  sla_due_at: string;
  sla_overdue: boolean;
  status: string;
  rating: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", waiting: "Waiting", completed: "Completed", closed: "Closed", cancelled: "Cancelled",
};
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  open: "outline", in_progress: "secondary", waiting: "secondary", completed: "outline", closed: "outline", cancelled: "destructive",
};
const PRIORITY_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  low: "outline", medium: "outline", high: "secondary", critical: "destructive",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function GaTicketsTable({ tickets, users }: { tickets: GaTicket[]; users: AppUserOption[] }) {
  const columns: DataColumn<GaTicket>[] = [
    {
      id: "ticket",
      header: "Tiket",
      sortable: true,
      accessor: (t) => t.ticket_no,
      cell: (t) => (
        <div>
          <div className="font-medium">{t.ticket_no}</div>
          <div className="text-muted-foreground text-xs">{t.title}</div>
        </div>
      ),
    },
    {
      id: "kategori",
      header: "Kategori",
      cell: (t) => <span>{t.category_icon ? `${t.category_icon} ` : ""}{t.category_nama}</span>,
    },
    {
      id: "priority",
      header: "Prioritas",
      cell: (t) => <Badge variant={PRIORITY_VARIANT[t.priority] ?? "outline"}>{t.priority}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      cell: (t) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
          {t.sla_overdue && <Badge variant="destructive">Overdue</Badge>}
        </div>
      ),
    },
    { id: "sla", header: "Batas SLA", cell: (t) => fmt(t.sla_due_at) },
    {
      id: "assignee",
      header: "Assignee",
      cell: (t) => <GaTicketAssignButton ticketId={t.id} currentName={t.assignee_name} users={users} />,
    },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
          <GaTicketTransitionActions ticketId={t.id} status={t.status} />
          <GaTicketTimelineButton ticketId={t.id} ticketNo={t.ticket_no} status={t.status} rating={t.rating} />
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={tickets} getKey={(t) => t.id} searchPlaceholder="Cari tiket…" pageSize={25} />;
}
