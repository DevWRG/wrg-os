"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangeToolbar } from "@/components/ui/date-range-toolbar";
import { ExportButton } from "@/components/ui/export-button";

interface VisitItem {
  id: string;
  am_id: string;
  nama: string | null;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
}

const GEO_LABEL: Record<string, string> = {
  ok: "Valid",
  out_of_bounds: "Di luar Indonesia",
  no_geo: "Tanpa GPS",
  date_mismatch: "Tanggal tak cocok",
};
const geoTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "ok" ? "secondary" : s === "no_geo" ? "outline" : "destructive";
const tgl = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const columns: DataColumn<VisitItem>[] = [
  { id: "am", header: "AM", sortable: true, accessor: (v) => v.nama ?? v.am_id, cell: (v) => <span className="font-medium">{v.nama ?? v.am_id}</span> },
  { id: "customer", header: "Customer", sortable: true, accessor: (v) => v.customer_name ?? "", cell: (v) => v.customer_name ?? "—" },
  { id: "tanggal", header: "Tanggal", sortable: true, accessor: (v) => v.visit_date ?? v.visit_timestamp ?? "", cell: (v) => <span className="text-muted-foreground">{tgl(v.visit_date ?? v.visit_timestamp)}</span> },
  {
    id: "koord",
    header: "Koordinat",
    accessor: (v) => (v.visit_lat !== null ? `${v.visit_lat},${v.visit_lon}` : ""),
    cell: (v) => (
      <span className="text-muted-foreground">
        {v.visit_lat !== null && v.visit_lon !== null ? `${v.visit_lat.toFixed(5)}, ${v.visit_lon.toFixed(5)}` : "—"}
      </span>
    ),
  },
  {
    id: "foto",
    header: "Foto",
    cell: (v) =>
      v.photo_url ? (
        <a
          href={`/api/media?p=${encodeURIComponent(v.photo_url)}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary underline underline-offset-2"
        >
          lihat
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { id: "geo", header: "Geo", sortable: true, accessor: (v) => v.geo_status, cell: (v) => <Badge variant={geoTone(v.geo_status)}>{GEO_LABEL[v.geo_status] ?? v.geo_status}</Badge> },
];

export function VisitsTable({ visits }: { visits: VisitItem[] }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = useMemo(() => {
    if (!from && !to) return visits;
    return visits.filter((v) => {
      const d = (v.visit_date ?? v.visit_timestamp ?? "").slice(0, 10);
      return d ? (!from || d >= from) && (!to || d <= to) : false;
    });
  }, [visits, from, to]);
  return (
    <DataTable
      columns={columns}
      data={filtered}
      getKey={(v) => v.id}
      searchPlaceholder="Cari AM / customer…"
      pageSize={25}
      onRowClick={(v) => router.push(`/visits/${v.id}`)}
      toolbar={
        <>
          <ExportButton
            filename="visits"
            data={filtered}
            columns={[
              { header: "AM", value: (v) => v.nama ?? v.am_id },
              { header: "Customer", value: (v) => v.customer_name },
              { header: "Tanggal", value: (v) => v.visit_date ?? v.visit_timestamp },
              { header: "Lat", value: (v) => v.visit_lat },
              { header: "Lon", value: (v) => v.visit_lon },
              { header: "Geo", value: (v) => v.geo_status },
            ]}
          />
          <DateRangeToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} idPrefix="vs" />
        </>
      }
    />
  );
}
