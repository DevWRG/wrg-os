"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { AuditFindingDetailDialog } from "./audit-finding-detail-dialog";
import { STATUS_LABEL, STATUS_VARIANT, type AuditFinding } from "./audit-findings-types";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function AuditFindingsTable({ findings }: { findings: AuditFinding[] }) {
  const columns: DataColumn<AuditFinding>[] = [
    {
      id: "temuan",
      header: "Temuan",
      sortable: true,
      accessor: (f) => f.kode,
      cell: (f) => (
        <div>
          <div className="font-medium">{f.kode}</div>
          <div className="text-muted-foreground text-xs">{f.title}</div>
        </div>
      ),
    },
    { id: "source", header: "Sumber", cell: (f) => f.source ?? "-" },
    { id: "unit", header: "Unit Terdampak", cell: (f) => f.unit_terdampak ?? "-" },
    { id: "linkage", header: "Control Linkage", cell: (f) => f.control_linkage ?? "-" },
    { id: "due", header: "Due Date", cell: (f) => (f.due_date ? fmt(f.due_date) : "-") },
    {
      id: "status",
      header: "Status",
      cell: (f) => <Badge variant={STATUS_VARIANT[f.status]}>{STATUS_LABEL[f.status]}</Badge>,
    },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (f) => <AuditFindingDetailDialog findingId={f.id} kode={f.kode} />,
    },
  ];

  return <DataTable columns={columns} data={findings} getKey={(f) => f.id} searchPlaceholder="Cari temuan…" pageSize={25} />;
}
