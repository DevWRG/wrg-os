"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ItAssetRowActions } from "@/components/crm/it-asset-row-actions";

export interface ItAsset {
  id: string;
  asset_code: string;
  nama: string;
  lokasi: string | null;
  pic_default: string | null;
  is_critical: boolean;
  active: boolean;
}

export function ItAssetsTable({ assets }: { assets: ItAsset[] }) {
  const columns: DataColumn<ItAsset>[] = [
    {
      id: "kode",
      header: "Aset",
      sortable: true,
      accessor: (a) => a.asset_code,
      cell: (a) => (
        <div>
          <div className="font-medium">{a.asset_code}</div>
          <div className="text-muted-foreground text-xs">{a.nama}</div>
        </div>
      ),
    },
    { id: "lokasi", header: "Lokasi", cell: (a) => a.lokasi ?? <span className="text-muted-foreground text-xs">-</span> },
    { id: "pic", header: "PIC Default", cell: (a) => a.pic_default ?? <span className="text-muted-foreground text-xs">belum diisi</span> },
    {
      id: "kritis",
      header: "Kritis",
      cell: (a) => (a.is_critical ? <Badge variant="destructive">Kritis (SLA 2 jam)</Badge> : <Badge variant="outline">Normal</Badge>),
    },
    {
      id: "aktif",
      header: "Status",
      cell: (a) => (a.active ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (a) => <ItAssetRowActions asset={a} /> },
  ];

  return (
    <DataTable columns={columns} data={assets} getKey={(a) => a.id} searchPlaceholder="Cari kode aset / nama…" pageSize={25} />
  );
}
