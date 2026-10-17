"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { cn } from "@/lib/utils";
import type { TahapFaktur, TukarFakturHasil, TukarFakturItem } from "./types";

const LABEL: Record<TahapFaktur, string> = { terbit: "Terbit", dicetak: "Dicetak", lunas: "Lunas" };
const URUT: TahapFaktur[] = ["terbit", "dicetak", "lunas"];
/** Selaras HARI_TUA di apps/api/src/repo/tukar-faktur.ts — penanda TUA sudah dihitung di API. */
const HARI_TUA = 7;

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const kolom: DataColumn<TukarFakturItem>[] = [
  { id: "nomor", header: "Faktur", sortable: true, accessor: (r) => r.nomor },
  { id: "customer", header: "Customer", sortable: true, accessor: (r) => r.customer },
  {
    id: "tahap", header: "Tahap", sortable: true, accessor: (r) => LABEL[r.tahap],
    cell: (r) => <Badge variant={r.tahap === "lunas" ? "outline" : "secondary"}>{LABEL[r.tahap]}</Badge>,
  },
  {
    id: "kategori", header: "Kategori", accessor: (r) => r.kategori.join(", "),
    cell: (r) => (r.kategori.length ? r.kategori.join(", ") : "—"),
  },
  { id: "tanggal", header: "Tgl faktur", sortable: true, searchable: false, accessor: (r) => r.tanggal ?? "", cell: (r) => r.tanggal ?? "—" },
  {
    id: "jatuh_tempo", header: "Jatuh tempo", sortable: true, searchable: false, accessor: (r) => r.jatuh_tempo ?? "",
    cell: (r) => (
      <span className={cn(r.overdue && "font-semibold text-destructive")}>
        {r.jatuh_tempo ?? "—"}{r.overdue ? " · lewat" : ""}
      </span>
    ),
  },
  {
    id: "outstanding", header: "Sisa tagihan", align: "right", sortable: true, searchable: false,
    accessor: (r) => r.outstanding, cell: (r) => rp(r.outstanding),
  },
  {
    id: "umur", header: "Umur", align: "right", sortable: true, searchable: false,
    accessor: (r) => r.umur_hari ?? -1,
    cell: (r) => r.umur_hari === null
      ? "—"
      : (
        <span className={cn("tabular-nums", r.tua && "font-semibold text-destructive")}>
          {r.umur_hari} hari{r.tua ? " · TUA" : ""}
        </span>
      ),
  },
];

const kolomExport: ExportColumn<TukarFakturItem>[] = [
  { header: "Faktur", value: (r) => r.nomor },
  { header: "Customer", value: (r) => r.customer },
  { header: "Tahap", value: (r) => LABEL[r.tahap] },
  { header: "Kategori", value: (r) => r.kategori.join(", ") },
  { header: "Tgl faktur", value: (r) => r.tanggal },
  { header: "Jatuh tempo", value: (r) => r.jatuh_tempo },
  { header: "Tgl bayar", value: (r) => r.tgl_bayar },
  { header: "Total", value: (r) => r.total },
  { header: "Sisa tagihan", value: (r) => r.outstanding },
  { header: "Umur (hari)", value: (r) => r.umur_hari },
  { header: "TUA", value: (r) => (r.tua ? "ya" : "tidak") },
];

export function TrackerView({ data }: { data: TukarFakturHasil }) {
  const [tahap, setTahap] = useState<TahapFaktur | null>(null);
  const [hanyaTua, setHanyaTua] = useState(false);
  const tampil = data.items
    .filter((i) => (tahap ? i.tahap === tahap : true))
    .filter((i) => (hanyaTua ? i.tua : true));
  const diperbarui = new Date(data.generated_at).toLocaleString("id-ID", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  });
  const chip = (aktif: boolean) =>
    cn("rounded-md border px-3 py-1.5 text-sm", aktif ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent");

  return (
    <div className="space-y-4">
      {data.terpotong && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <strong>Daftar terpotong.</strong> Terlalu banyak faktur dalam {data.hari} hari terakhir; sebagian tidak tampil.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTahap(null)} className={chip(tahap === null)}>
          Semua <span className="tabular-nums">{data.total}</span>
        </button>
        {URUT.map((t) => (
          <button key={t} type="button" onClick={() => setTahap(tahap === t ? null : t)} className={chip(tahap === t)}>
            {LABEL[t]} <span className="tabular-nums">{data.per_tahap[t]}</span>
          </button>
        ))}
        <button type="button" onClick={() => setHanyaTua((v) => !v)} className={chip(hanyaTua)}>
          TUA &gt; {HARI_TUA} hari <span className="tabular-nums">{data.tua}</span>
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {data.hari} hari terakhir · diperbarui {diperbarui}
        </span>
      </div>
      <div className="flex justify-end">
        <ExportButton filename="tukar-faktur" columns={kolomExport} data={tampil} label="Export CSV" />
      </div>
      <DataTable
        columns={kolom} data={tampil} getKey={(r) => r.id}
        searchPlaceholder="Cari faktur, customer, atau kategori…" pageSize={25}
        empty="Tidak ada faktur pada filter ini."
        initialSort={{ id: "umur", dir: "desc" }}
      />
      <p className="text-xs text-muted-foreground">
        Tahap hanya yang tercatat di Accurate: Terbit → Dicetak → Lunas. Tahap tukar faktur (dikirim, ditandatangani)
        tidak dicatat di Accurate sehingga belum tampil. Umur dihitung sejak tanggal cetak (cadangan: tanggal faktur) dan
        ditandai TUA bila lebih dari {HARI_TUA} hari sebelum lunas. Faktur lama bisa tampak belum lunas karena data
        Accurate hanya disegarkan untuk faktur 7 hari terakhir.
      </p>
    </div>
  );
}
