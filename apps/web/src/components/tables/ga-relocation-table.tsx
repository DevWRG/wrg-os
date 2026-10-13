"use client";

import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface GaRelocation {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  from_location: string | null;
  to_location: string;
  from_pic: string | null;
  to_pic: string | null;
  pic_berubah: boolean;
  relocation_date: string;
  reason: string | null;
  ba_path: string;
  ba_file_name: string | null;
  created_by_name: string | null;
  created_at: string;
}

const strip = <span className="text-muted-foreground text-xs">—</span>;

const columns: DataColumn<GaRelocation>[] = [
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => r.relocation_date, cell: (r) => <span className="tabular-nums">{r.relocation_date}</span> },
  {
    id: "aset", header: "Aset", sortable: true, accessor: (r) => r.asset_code,
    cell: (r) => (
      <div>
        <div className="font-medium">{r.asset_code}</div>
        <div className="text-muted-foreground text-xs">{r.asset_nama}</div>
      </div>
    ),
  },
  {
    id: "lokasi", header: "Lokasi", accessor: (r) => `${r.from_location ?? ""} ${r.to_location}`,
    cell: (r) => (
      <span>
        {r.from_location ?? "—"} <span className="text-muted-foreground">→</span> <span className="font-medium">{r.to_location}</span>
      </span>
    ),
  },
  {
    id: "pic", header: "PIC", accessor: (r) => `${r.from_pic ?? ""} ${r.to_pic ?? ""}`,
    cell: (r) =>
      r.pic_berubah ? (
        <span>{r.from_pic ?? "—"} <span className="text-muted-foreground">→</span> {r.to_pic ?? "—"}</span>
      ) : (
        <span>{r.to_pic ?? "—"} <Badge variant="outline" className="ml-1">tetap</Badge></span>
      ),
  },
  { id: "alasan", header: "Alasan", cell: (r) => r.reason ?? strip },
  { id: "oleh", header: "Dicatat oleh", accessor: (r) => r.created_by_name ?? "", cell: (r) => r.created_by_name ?? strip },
  {
    id: "ba", header: "Berita Acara", align: "right",
    cell: (r) => (
      <a
        href={`/api/media?p=${encodeURIComponent(r.ba_path)}`}
        target="_blank"
        rel="noreferrer"
        className="text-primary inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
        title={r.ba_file_name ?? "berita acara"}
      >
        <FileText className="size-4" /> Lihat
      </a>
    ),
  },
];

export function GaRelocationTable({ rows }: { rows: GaRelocation[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      getKey={(r) => r.id}
      searchPlaceholder="Cari kode aset, lokasi, PIC…"
      pageSize={25}
      initialSort={{ id: "tanggal", dir: "desc" }}
    />
  );
}
