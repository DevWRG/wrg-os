"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { HolidayRowActions } from "@/components/crm/holiday-row-actions";

interface Holiday {
  id: string;
  tanggal: string;
  keterangan: string;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
};

const columns: DataColumn<Holiday>[] = [
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (h) => h.tanggal, cell: (h) => <span className="font-medium whitespace-nowrap">{tgl(h.tanggal)}</span> },
  { id: "keterangan", header: "Keterangan", sortable: true, accessor: (h) => h.keterangan },
  { id: "aksi", header: "Aksi", align: "right", cell: (h) => <HolidayRowActions id={h.id} tanggal={h.tanggal} keterangan={h.keterangan} /> },
];

export function HolidaysTable({ holidays }: { holidays: Holiday[] }) {
  return <DataTable columns={columns} data={holidays} getKey={(h) => h.id} searchPlaceholder="Cari hari libur…" pageSize={25} />;
}
