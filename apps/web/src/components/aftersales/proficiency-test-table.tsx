"use client";

import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ProficiencyTestRowActions } from "@/components/aftersales/proficiency-test-row-actions";

export type ProficiencyTestStatus = "valid" | "expiring_soon" | "expired";

export interface ProficiencyTestRow {
  id: string;
  rs_name: string;
  test_name: string;
  provider: string | null;
  cert_number: string | null;
  issued_date: string | null;
  expired_date: string;
  cabang: string | null;
  pic: string | null;
  notes: string | null;
  file_name: string | null;
  has_file: boolean;
  days_to_expiry: number;
  status: ProficiencyTestStatus;
}

const tgl = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_BADGE: Record<ProficiencyTestStatus, { label: string; cls: string }> = {
  valid: { label: "Valid", cls: "bg-success-soft text-success" },
  expiring_soon: { label: "Segera Berakhir", cls: "bg-warning-soft text-warning" },
  expired: { label: "Kedaluwarsa", cls: "bg-danger-soft text-danger" },
};

export function ProficiencyTestTable({ rows }: { rows: ProficiencyTestRow[] }) {
  const columns: DataColumn<ProficiencyTestRow>[] = [
    { id: "rs", header: "RS / Faskes", sortable: true, accessor: (r) => r.rs_name, cell: (r) => <span className="font-medium">{r.rs_name}</span> },
    { id: "test", header: "Uji Profisiensi", sortable: true, accessor: (r) => r.test_name },
    { id: "provider", header: "Penyelenggara", sortable: true, accessor: (r) => r.provider ?? "", cell: (r) => r.provider ?? "—" },
    { id: "cert", header: "No. Sertifikat", accessor: (r) => r.cert_number ?? "", cell: (r) => r.cert_number ?? "—" },
    { id: "issued", header: "Tgl Terbit", sortable: true, accessor: (r) => r.issued_date ?? "", cell: (r) => tgl(r.issued_date) },
    { id: "expired", header: "ED", sortable: true, accessor: (r) => r.expired_date, cell: (r) => <span className="font-medium whitespace-nowrap">{tgl(r.expired_date)}</span> },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (r) => r.days_to_expiry,
      cell: (r) => {
        const b = STATUS_BADGE[r.status];
        return (
          <div className="flex flex-col gap-0.5">
            <Badge className={b.cls}>{b.label}</Badge>
            <span className="text-muted-foreground text-xs">
              {r.status === "expired" ? `H+${Math.abs(r.days_to_expiry)}` : `H-${r.days_to_expiry}`}
            </span>
          </div>
        );
      },
    },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => r.cabang ?? "—" },
    { id: "pic", header: "PIC", accessor: (r) => r.pic ?? "", cell: (r) => r.pic ?? "—" },
    {
      id: "file",
      header: "Sertifikat",
      cell: (r) =>
        r.has_file ? (
          <a
            href={`/api/aftersales/proficiency-tests/${r.id}/file`}
            className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            <Download className="size-3.5" /> Unduh
          </a>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (r) => <ProficiencyTestRowActions row={r} /> },
  ];

  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari RS / uji profisiensi…" pageSize={25} />;
}
