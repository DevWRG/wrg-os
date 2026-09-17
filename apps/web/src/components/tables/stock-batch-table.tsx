"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface StockBatchRow {
  item_id: string;
  no: string;
  name: string;
  unit: string | null;
  warehouse_kode: string;
  warehouse_nama: string;
  batch_no: string;
  ed_date: string | null;
  quantity: number;
  sisa_hari: number | null;
  tier: number | null;
  sudah_lewat: boolean;
  ada_histori_kso: boolean;
  saran: "retur" | "trial" | "kso" | "reguler" | null;
  saran_label: string | null;
  source: string;
  alert_tier_terkirim: number | null;
  alert_terkirim_at: string | null;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID").format(n);

// timeZone UTC — string "2026-08-20" diparse sebagai tengah malam UTC, jadi tanpa
// ini nama tanggal bergeser untuk penonton di offset negatif dan bisa
// bertentangan dengan hitungan sisa-hari yang dibuat server (WIB).
const tgl = (iso: string | null) => {
  if (iso == null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

// Sentinel sort: batch tanpa ED selalu di ujung, terpisah dari sisa-hari negatif
// (sudah lewat). Bukan -1 (bentrok nilai nyata), bukan -Infinity (`av - bv` →
// NaN → urutan tak terdefinisi). Kolomnya `searchable: false` supaya angka
// sentinel tak ikut jadi teks pencarian.
const TAK_ADA = Number.MAX_SAFE_INTEGER;

const SARAN_LABEL: Record<string, string> = {
  retur: "retur/hapus",
  trial: "trial/promo",
  kso: "KSO",
  reguler: "reguler",
};

export function StockBatchTable({ rows }: { rows: StockBatchRow[] }) {
  const columns = useMemo<DataColumn<StockBatchRow>[]>(
    () => [
      {
        id: "no",
        header: "SKU",
        sortable: true,
        accessor: (r) => r.no,
        cell: (r) => <span className="font-medium whitespace-nowrap">{r.no}</span>,
        className: "bg-card sticky left-0 z-10",
      },
      {
        id: "name",
        header: "Nama",
        sortable: true,
        accessor: (r) => r.name,
        cell: (r) => (
          <span className="block max-w-[16rem] truncate" title={r.name}>
            {r.name}
          </span>
        ),
        className: "max-w-[16rem]",
      },
      { id: "gudang", header: "Gudang", sortable: true, accessor: (r) => r.warehouse_kode },
      { id: "batch", header: "Batch", sortable: true, accessor: (r) => r.batch_no },
      {
        id: "ed",
        header: "ED",
        sortable: true,
        searchable: false,
        // Diurutkan pakai sisa-hari, bukan string tanggal — supaya kunci sort
        // sama dengan yang dibaca orang di kolom sebelahnya.
        accessor: (r) => r.sisa_hari ?? TAK_ADA,
        cell: (r) => <span className="whitespace-nowrap">{tgl(r.ed_date)}</span>,
        className: "whitespace-nowrap",
      },
      {
        id: "sisa",
        header: "Sisa",
        align: "right",
        sortable: true,
        searchable: false,
        accessor: (r) => r.sisa_hari ?? TAK_ADA,
        cell: (r) => {
          if (r.sisa_hari == null) {
            return (
              <Badge variant="outline" title="Barang non-kedaluwarsa — tidak ikut alert">
                tanpa ED
              </Badge>
            );
          }
          if (r.sudah_lewat) {
            return (
              <Badge variant="destructive" title="Sudah melewati tanggal kedaluwarsa">
                lewat {Math.abs(r.sisa_hari)} hari
              </Badge>
            );
          }
          // Ambang terdekat diberi penekanan; sisanya netral. Warna bukan
          // satu-satunya pembeda — angkanya ikut tertulis.
          return (
            <Badge variant={r.tier === 30 ? "destructive" : r.tier === 60 ? "secondary" : "outline"}>
              {r.sisa_hari} hari
            </Badge>
          );
        },
      },
      {
        id: "qty",
        header: "Qty",
        align: "right",
        sortable: true,
        searchable: false,
        accessor: (r) => r.quantity,
        cell: (r) => (
          <span className="whitespace-nowrap">
            {fmt(r.quantity)}
            {r.unit ? ` ${r.unit}` : ""}
          </span>
        ),
        className: "whitespace-nowrap",
      },
      {
        id: "saran",
        header: "Saran alokasi",
        // Pakai label yang TAMPIL, bukan kode enum: mengetik "promo" atau
        // "hapus" harus menemukan barisnya. Dengan kode enum, teks yang terlihat
        // di badge justru tak bisa dicari.
        accessor: (r) => (r.saran == null ? "" : `${SARAN_LABEL[r.saran]} ${r.saran}`),
        cell: (r) =>
          r.saran == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              <Badge variant={r.saran === "retur" ? "destructive" : "outline"}>
                {SARAN_LABEL[r.saran]}
              </Badge>
              {r.ada_histori_kso && (
                <span className="text-muted-foreground text-xs" title="Item ini punya riwayat faktur berkategori KSO — petunjuk, bukan komitmen kontrak">
                  ada histori KSO
                </span>
              )}
            </div>
          ),
      },
      {
        id: "alert",
        header: "Sudah diberitahu",
        searchable: false,
        accessor: (r) => r.alert_tier_terkirim ?? 0,
        cell: (r) =>
          r.alert_tier_terkirim == null ? (
            <span className="text-muted-foreground text-xs">belum</span>
          ) : (
            <span className="text-muted-foreground text-xs">ambang {r.alert_tier_terkirim} hari</span>
          ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getKey={(r) => `${r.item_id}|${r.warehouse_kode}|${r.batch_no}`}
      searchPlaceholder="Cari SKU / nama / batch…"
      pageSize={25}
    />
  );
}
