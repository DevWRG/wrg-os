"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { AssetTagRowActions } from "@/components/crm/asset-tag-row-actions";

export interface AssetTag {
  id: string;
  kode: string;
  nama: string;
  jenis_kepemilikan: string;
  kategori: string | null;
  lokasi_cabang: string | null;
  letak: string | null;
  active: boolean;
  last_audit_at: string | null;
  last_audit_found: boolean | null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function AssetTagsTable({ assets }: { assets: AssetTag[] }) {
  const columns: DataColumn<AssetTag>[] = [
    {
      id: "kode",
      header: "Aset",
      sortable: true,
      accessor: (a) => a.kode,
      cell: (a) => (
        <div>
          <div className="font-medium">{a.kode}</div>
          <div className="text-muted-foreground text-xs">{a.nama}</div>
        </div>
      ),
    },
    {
      id: "jenis",
      header: "Jenis",
      cell: (a) => <Badge variant={a.jenis_kepemilikan === "aset" ? "default" : "secondary"}>{a.jenis_kepemilikan === "aset" ? "Aset" : "Inventaris"}</Badge>,
    },
    { id: "kategori", header: "Kategori", cell: (a) => a.kategori ?? <span className="text-muted-foreground text-xs">-</span> },
    {
      id: "lokasi",
      header: "Lokasi",
      cell: (a) => (a.lokasi_cabang || a.letak ? [a.lokasi_cabang, a.letak].filter(Boolean).join(" · ") : <span className="text-muted-foreground text-xs">-</span>),
    },
    {
      id: "audit",
      header: "Audit Terakhir",
      cell: (a) =>
        !a.last_audit_at ? (
          <span className="text-muted-foreground text-xs">belum pernah</span>
        ) : (
          <div>
            <Badge variant={a.last_audit_found ? "outline" : "destructive"}>{a.last_audit_found ? "Ditemukan" : "Tidak ditemukan"}</Badge>
            <div className="text-muted-foreground text-xs">{fmtDate(a.last_audit_at)}</div>
          </div>
        ),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (a) => <AssetTagRowActions asset={a} /> },
  ];

  return (
    <DataTable columns={columns} data={assets} getKey={(a) => a.id} searchPlaceholder="Cari kode / nama…" pageSize={25} />
  );
}
