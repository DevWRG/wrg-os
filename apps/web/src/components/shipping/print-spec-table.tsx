"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { PrintSpecRowActions } from "./print-spec-row-actions";

export interface PrintSpecRow {
  id: string;
  document_type: string;
  paper_size: "A4" | "A5" | "A6" | "F4" | "Letter";
  orientation: "portrait" | "landscape";
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  font_family: string;
  font_size_pt: number;
  has_letterhead: boolean;
  header_spec: string | null;
  footer_spec: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
}

const ORIENTATION_LABEL: Record<PrintSpecRow["orientation"], string> = {
  portrait: "Potrait",
  landscape: "Landscape",
};

const columns: DataColumn<PrintSpecRow>[] = [
  { id: "document_type", header: "Jenis Dokumen", sortable: true, accessor: (r) => r.document_type, cell: (r) => <span className="font-medium">{r.document_type}</span> },
  { id: "paper_size", header: "Ukuran", sortable: true, accessor: (r) => r.paper_size },
  { id: "orientation", header: "Orientasi", sortable: true, accessor: (r) => r.orientation, cell: (r) => ORIENTATION_LABEL[r.orientation] },
  {
    id: "margin", header: "Margin (mm)", accessor: (r) => r.margin_top_mm,
    cell: (r) => <span className="tabular-nums">{r.margin_top_mm}/{r.margin_right_mm}/{r.margin_bottom_mm}/{r.margin_left_mm}</span>,
  },
  { id: "font", header: "Font", accessor: (r) => r.font_family, cell: (r) => <span className="whitespace-nowrap">{r.font_family} {r.font_size_pt}pt</span> },
  {
    id: "has_letterhead", header: "Letterhead", accessor: (r) => (r.has_letterhead ? 1 : 0),
    cell: (r) => (r.has_letterhead ? <Badge variant="outline">Ya</Badge> : <span className="text-muted-foreground">—</span>),
  },
  {
    id: "is_active", header: "Status", accessor: (r) => (r.is_active ? 1 : 0),
    cell: (r) => (r.is_active ? <Badge className="bg-success/10 text-success">Aktif</Badge> : <Badge variant="outline">Nonaktif</Badge>),
  },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <PrintSpecRowActions row={r} /> },
];

export function PrintSpecTable({ rows }: { rows: PrintSpecRow[] }) {
  const [status, setStatus] = useState("");

  const filtered = useMemo(
    () => (status ? rows.filter((r) => (status === "active" ? r.is_active : !r.is_active)) : rows),
    [rows, status],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      getKey={(r) => r.id}
      searchPlaceholder="Cari jenis dokumen…"
      pageSize={25}
      initialSort={{ id: "document_type", dir: "asc" }}
      toolbar={
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Aktif" },
            { value: "inactive", label: "Nonaktif" },
          ]}
        />
      }
    />
  );
}
