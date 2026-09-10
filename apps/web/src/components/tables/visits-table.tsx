"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { photoHref } from "@/lib/media";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableUrl } from "@/lib/use-table-url";
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
  tujuan: string | null;
  goal: string | null;
  catatan: string | null;
  activity_type: string | null;
  account_id: number | null;
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

// id kolom yang bisa di-sort HARUS sama dengan VISIT_SORTS di apps/api
// (repo/visit.ts) — nilainya dikirim apa adanya sebagai ?sort=. Kolom yang tak
// ada di sana (koord, foto) sengaja tanpa `sortable`.
const columns: DataColumn<VisitItem>[] = [
  { id: "am", header: "AM", sortable: true, accessor: (v) => v.nama ?? v.am_id, cell: (v) => <span className="font-medium">{v.nama ?? v.am_id}</span> },
  {
    id: "customer",
    header: "Customer",
    sortable: true,
    accessor: (v) => v.customer_name ?? "",
    // account_id terisi = nama faskes berhasil di-resolve ke Account 360 (F62);
    // yang belum ter-resolve tetap tampil sebagai teks biasa, bukan disembunyikan.
    cell: (v) =>
      v.customer_name ? (
        v.account_id !== null ? (
          <Link
            href={`/accounts/${v.account_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline-offset-2 hover:underline"
          >
            {v.customer_name}
          </Link>
        ) : (
          v.customer_name
        )
      ) : (
        "—"
      ),
  },
  {
    id: "tipe",
    header: "Tipe",
    sortable: true,
    accessor: (v) => v.activity_type ?? "",
    cell: (v) => (v.activity_type ? <Badge variant="outline">{v.activity_type}</Badge> : <span className="text-muted-foreground">—</span>),
  },
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
          href={photoHref(v.photo_url)}
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

const EXPORT_COLUMNS = [
  { header: "Periode", value: (v: VisitItem) => v.visit_date ?? v.visit_timestamp },
  { header: "AM", value: (v: VisitItem) => v.nama ?? v.am_id },
  { header: "Customer", value: (v: VisitItem) => v.customer_name },
  { header: "Tipe", value: (v: VisitItem) => v.activity_type ?? "" },
  { header: "Tanggal", value: (v: VisitItem) => v.visit_date ?? v.visit_timestamp },
  { header: "Tujuan", value: (v: VisitItem) => v.tujuan ?? "" },
  { header: "Goal", value: (v: VisitItem) => v.goal ?? "" },
  { header: "Catatan", value: (v: VisitItem) => v.catatan ?? "" },
  { header: "Lat", value: (v: VisitItem) => v.visit_lat },
  { header: "Lon", value: (v: VisitItem) => v.visit_lon },
  { header: "Geo", value: (v: VisitItem) => GEO_LABEL[v.geo_status] ?? v.geo_status },
  { header: "Maps", value: (v: VisitItem) => (v.visit_lat !== null && v.visit_lon !== null ? `https://maps.google.com/?q=${v.visit_lat},${v.visit_lon}` : "") },
  { header: "Foto", value: (v: VisitItem) => v.photo_url ?? "" },
];

/** Plafon export — sama dengan VISIT_PAGE_MAX di apps/api (repo/visit.ts). */
const EXPORT_LIMIT = 5000;

export interface VisitsQuery {
  q: string;
  from: string;
  to: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  size: number;
}

export function VisitsTable({
  visits,
  totalRows,
  query,
}: {
  visits: VisitItem[];
  /** jumlah kunjungan yang COCOK FILTER di backend, bukan panjang `visits`. */
  totalRows: number;
  query: VisitsQuery;
}) {
  const router = useRouter();
  // params masih dipakai fetchAll (baca ?status= utk export), bukan utk navigasi.
  const params = useSearchParams();
  const { push, qInput, setQInput, pending } = useTableUrl(query.q);

  // Export mengambil SELURUH baris yang cocok filter dari backend — bukan
  // halaman yang sedang tampil. Filternya identik dengan yang dipakai tabel,
  // jadi isi file selalu sama dengan yang dilihat user, cuma tanpa paginasi.
  const fetchAll = useCallback(async (): Promise<VisitItem[]> => {
    const qs = new URLSearchParams();
    const status = params.get("status");
    if (status) qs.set("status", status);
    if (query.q) qs.set("q", query.q);
    if (query.from) qs.set("from", query.from);
    if (query.to) qs.set("to", query.to);
    qs.set("sort", query.sort);
    qs.set("dir", query.dir);
    qs.set("limit", String(EXPORT_LIMIT));
    const res = await fetch(`/api/visits?${qs.toString()}`);
    if (!res.ok) throw new Error("gagal mengambil data export");
    const data = (await res.json()) as { visits?: VisitItem[] };
    return data.visits ?? [];
  }, [params, query.q, query.from, query.to, query.sort, query.dir]);

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={visits}
        getKey={(v) => v.id}
        searchPlaceholder="Cari AM / customer…"
        onRowClick={(v) => router.push(`/visits/${v.id}`)}
        server={{
          totalRows,
          page: query.page,
          pageSize: query.size,
          sort: { id: query.sort, dir: query.dir },
          q: qInput,
          pending,
          onPageChange: (p) => push({ page: p === 0 ? null : p }),
          onPageSizeChange: (n) => push({ size: n, page: null }),
          onSortChange: (s) =>
            push({ sort: s?.id ?? null, dir: s?.dir ?? null, page: null }),
          onSearchChange: setQInput,
        }}
        toolbar={
          <>
            <ExportButton filename="visits-detail" fetchData={fetchAll} columns={EXPORT_COLUMNS} />
            <DateRangeToolbar
              from={query.from}
              to={query.to}
              onFrom={(v) => push({ from: v || null, page: null })}
              onTo={(v) => push({ to: v || null, page: null })}
              idPrefix="vs"
            />
          </>
        }
      />
      {totalRows > EXPORT_LIMIT && (
        <p className="text-muted-foreground text-xs">
          Export dibatasi {EXPORT_LIMIT.toLocaleString("id-ID")} baris teratas dari {totalRows.toLocaleString("id-ID")} —
          persempit rentang tanggal untuk mengekspor sisanya.
        </p>
      )}
    </div>
  );
}
