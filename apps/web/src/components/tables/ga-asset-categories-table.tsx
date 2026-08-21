"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaAssetCategoryRowActions } from "@/components/crm/ga-asset-category-row-actions";

export interface GaAssetCategory {
  id: string;
  code: string;
  nama: string;
  depreciation_years: number | null;
  icon: string | null;
  is_shared: boolean;
  active: boolean;
}

export function GaAssetCategoriesTable({ categories }: { categories: GaAssetCategory[] }) {
  const columns: DataColumn<GaAssetCategory>[] = [
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
    {
      id: "depresiasi",
      header: "Depresiasi",
      cell: (c) => (c.depreciation_years ? `${c.depreciation_years} tahun` : <span className="text-muted-foreground text-xs">-</span>),
    },
    {
      id: "shared",
      header: "Shared",
      cell: (c) => (c.is_shared ? <Badge variant="outline">Boleh multi-PIC</Badge> : <span className="text-muted-foreground text-xs">1 PIC aktif</span>),
    },
    {
      id: "aktif",
      header: "Status",
      cell: (c) => (c.active ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (c) => <GaAssetCategoryRowActions category={c} /> },
  ];

  return <DataTable columns={columns} data={categories} getKey={(c) => c.id} searchPlaceholder="Cari kategori…" pageSize={25} />;
}
