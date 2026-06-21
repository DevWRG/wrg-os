"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { TerritoryRowActions } from "@/components/watchpoint/territory-row-actions";
import { hodLabel } from "@/components/watchpoint/hod-options";

export interface TerritoryRow {
  id: string;
  hod_key: string;
  cabang: string;
  source: string;
  updated_at: string;
}

const columns: DataColumn<TerritoryRow>[] = [
  { id: "hod", header: "HoD", sortable: true, accessor: (r) => r.hod_key, cell: (r) => <span className="font-medium whitespace-nowrap">{hodLabel(r.hod_key)}</span> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang },
  { id: "source", header: "Sumber", sortable: true, accessor: (r) => r.source },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <TerritoryRowActions id={r.id} hod_key={r.hod_key} cabang={r.cabang} /> },
];

export function TerritoryTable({ rows }: { rows: TerritoryRow[] }) {
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari HoD / cabang…" pageSize={50} />;
}
