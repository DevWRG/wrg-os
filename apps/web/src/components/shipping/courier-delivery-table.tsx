"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { CourierDeliveryRowActions } from "./courier-delivery-row-actions";

export interface CourierDeliveryRow {
  id: string;
  kurir_name: string;
  kurir_wa_number: string | null;
  sj_number: string | null;
  customer_name: string | null;
  cabang: string | null;
  tanggal_kirim: string;
  target_tiba_date: string | null;
  tanggal_tiba: string | null;
  distance_km: number | null;
  status: "dalam_perjalanan" | "selesai" | "bermasalah";
  notes: string | null;
  created_by: string | null;
  is_late: boolean;
  is_overdue: boolean;
  duration_days: number | null;
}

const tgl = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const STATUS_LABEL: Record<CourierDeliveryRow["status"], string> = {
  dalam_perjalanan: "Dalam Perjalanan",
  selesai: "Selesai",
  bermasalah: "Bermasalah",
};

function StatusBadge({ row }: { row: CourierDeliveryRow }) {
  if (row.status === "bermasalah") return <Badge variant="destructive">Bermasalah</Badge>;
  if (row.status === "selesai") {
    // tanggal_tiba kosong pada status "selesai" seharusnya tak terjadi lewat form
    // (BUG-13 fix), tapi kalau tetap terjadi (data lama/API lain), is_late ikut
    // NULL di SQL (`tanggal_tiba > target_tiba_date` dgn NULL) → jangan
    // diasumsikan "Tepat Waktu", karena datanya memang belum diketahui.
    if (!row.tanggal_tiba) return <Badge variant="outline">Selesai · Tgl Tiba belum tercatat</Badge>;
    return row.is_late
      ? <Badge className="bg-warning/10 text-warning">Selesai · Telat</Badge>
      : <Badge className="bg-success/10 text-success">Selesai · Tepat Waktu</Badge>;
  }
  return row.is_overdue
    ? <Badge className="bg-warning/10 text-warning">Dalam Perjalanan · Lewat Target</Badge>
    : <Badge variant="outline">Dalam Perjalanan</Badge>;
}

const columns: DataColumn<CourierDeliveryRow>[] = [
  { id: "kurir_name", header: "Kurir/Ekspedisi", sortable: true, accessor: (r) => r.kurir_name, cell: (r) => <span className="font-medium">{r.kurir_name}</span> },
  { id: "sj_number", header: "No. SJ", sortable: true, accessor: (r) => r.sj_number ?? "", cell: (r) => r.sj_number ?? "—" },
  { id: "customer_name", header: "Customer", sortable: true, accessor: (r) => r.customer_name ?? "", cell: (r) => <span className="text-muted-foreground">{r.customer_name ?? "—"}</span> },
  { id: "tanggal_kirim", header: "Tgl Kirim", sortable: true, accessor: (r) => r.tanggal_kirim, cell: (r) => <span className="whitespace-nowrap">{tgl(r.tanggal_kirim)}</span> },
  { id: "tanggal_tiba", header: "Tgl Tiba", sortable: true, accessor: (r) => r.tanggal_tiba ?? "", cell: (r) => <span className="whitespace-nowrap">{tgl(r.tanggal_tiba)}</span> },
  { id: "duration_days", header: "Durasi", sortable: true, accessor: (r) => r.duration_days ?? -1, cell: (r) => (r.duration_days != null ? `${r.duration_days} hari` : "—") },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <CourierDeliveryRowActions row={r} /> },
];

export function CourierDeliveryTable({ rows }: { rows: CourierDeliveryRow[] }) {
  const [status, setStatus] = useState("");

  const filtered = useMemo(
    () => (status ? rows.filter((r) => r.status === status) : rows),
    [rows, status],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      getKey={(r) => r.id}
      searchPlaceholder="Cari kurir / SJ / customer…"
      pageSize={25}
      initialSort={{ id: "tanggal_kirim", dir: "desc" }}
      toolbar={
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
        />
      }
    />
  );
}
