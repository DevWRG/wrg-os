"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaTicketCategoryRowActions } from "@/components/crm/ga-ticket-category-row-actions";

export interface GaTicketCategory {
  id: string;
  code: string;
  nama: string;
  icon: string | null;
  default_sla_hours: number;
  default_priority: string;
  active: boolean;
}

const PRIORITY_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  low: "outline",
  medium: "outline",
  high: "secondary",
  critical: "destructive",
};

export function GaTicketCategoriesTable({ categories }: { categories: GaTicketCategory[] }) {
  const columns: DataColumn<GaTicketCategory>[] = [
    {
      id: "kode",
      header: "Kategori",
      sortable: true,
      accessor: (c) => c.code,
      cell: (c) => (
        <div>
          <div className="font-medium">{c.icon ? `${c.icon} ` : ""}{c.nama}</div>
          <div className="text-muted-foreground text-xs">{c.code}</div>
        </div>
      ),
    },
    { id: "sla", header: "SLA default", cell: (c) => `${c.default_sla_hours} jam` },
    {
      id: "priority",
      header: "Prioritas default",
      cell: (c) => <Badge variant={PRIORITY_VARIANT[c.default_priority] ?? "outline"}>{c.default_priority}</Badge>,
    },
    {
      id: "aktif",
      header: "Status",
      cell: (c) => (c.active ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (c) => <GaTicketCategoryRowActions category={c} /> },
  ];

  return <DataTable columns={columns} data={categories} getKey={(c) => c.id} searchPlaceholder="Cari kategori…" pageSize={25} />;
}
