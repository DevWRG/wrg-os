"use client";

import { CheckCircle2, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { InstallationRowActions } from "@/components/crm/installation-row-actions";

export interface InstallationUnit {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  po_number: string | null;
  po_control_done: boolean;
  sj_done: boolean;
  teknisi_assign_done: boolean;
  training_done: boolean;
  bast_done: boolean;
  status: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  po_control: "PO Control",
  sj: "SJ",
  teknisi_assign: "Teknisi Assign",
  training: "Training",
  bast: "BAST (Selesai)",
};

const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "bast" ? "secondary" : s === "draft" ? "outline" : "default";

function ProgressDots({ u }: { u: InstallationUnit }) {
  const steps = [u.po_control_done, u.sj_done, u.teknisi_assign_done, u.training_done, u.bast_done];
  return (
    <div className="flex items-center gap-1" title="PO control → SJ → Teknisi assign → Training → BAST">
      {steps.map((done, i) =>
        done ? (
          <CheckCircle2 key={i} className="text-success size-4" />
        ) : (
          <Circle key={i} className="text-muted-foreground/40 size-4" />
        ),
      )}
    </div>
  );
}

export function InstallationsTable({ units }: { units: InstallationUnit[] }) {
  const columns: DataColumn<InstallationUnit>[] = [
    {
      id: "alat",
      header: "Alat",
      sortable: true,
      accessor: (u) => u.alat_name,
      cell: (u) => (
        <div>
          <div className="font-medium">{u.alat_name}</div>
          {u.serial_number && <div className="text-muted-foreground text-xs">SN: {u.serial_number}</div>}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      sortable: true,
      accessor: (u) => u.customer_name,
      cell: (u) => (
        <div>
          <div>{u.customer_name}</div>
          {u.cabang && <div className="text-muted-foreground text-xs">{u.cabang}</div>}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (u) => u.status,
      cell: (u) => <Badge variant={statusTone(u.status)}>{STATUS_LABEL[u.status] ?? u.status}</Badge>,
    },
    { id: "progress", header: "Progress", cell: (u) => <ProgressDots u={u} /> },
    { id: "aksi", header: "Aksi", align: "right", cell: (u) => <InstallationRowActions row={u} /> },
  ];

  return (
    <DataTable columns={columns} data={units} getKey={(u) => u.id} searchPlaceholder="Cari alat / customer…" pageSize={25} />
  );
}
