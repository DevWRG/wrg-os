"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { cn } from "@/lib/utils";
import type { InboxHasil, InboxItem, JenisInbox } from "./types";

const LABEL: Record<JenisInbox, string> = {
  approval: "Approval F11",
  po: "Purchase Order",
  fund: "Dana Operasional",
  insentif: "Insentif",
  lembur: "Lembur",
};
const URUT: JenisInbox[] = ["approval", "po", "fund", "insentif", "lembur"];

/** Lewat ambang ini item ditandai merah — antrean Direktur yang menua. */
const HARI_LAMBAT = 3;

const rp = (n: number | null) => (n === null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`);

const kolom: DataColumn<InboxItem>[] = [
  {
    id: "jenis", header: "Jenis", sortable: true, accessor: (r) => LABEL[r.jenis],
    cell: (r) => <Badge variant="secondary">{LABEL[r.jenis]}</Badge>,
  },
  { id: "kode", header: "Kode", sortable: true, accessor: (r) => r.kode },
  { id: "judul", header: "Perihal", sortable: true, accessor: (r) => r.judul },
  { id: "pengaju", header: "Pengaju", sortable: true, accessor: (r) => r.pengaju ?? "" },
  {
    id: "nominal", header: "Nominal", align: "right", sortable: true, searchable: false,
    accessor: (r) => r.nominal ?? -1, cell: (r) => rp(r.nominal),
  },
  {
    id: "umur", header: "Menunggu", align: "right", sortable: true, searchable: false,
    accessor: (r) => r.umur_hari,
    cell: (r) => (
      <span className={cn("tabular-nums", r.umur_hari > HARI_LAMBAT && "font-semibold text-destructive")}>
        {r.umur_hari} hari
      </span>
    ),
  },
  {
    id: "aksi", header: "", align: "right", searchable: false,
    cell: (r) => (
      <Link href={r.link} className="text-sm font-medium text-primary hover:underline">
        Buka →
      </Link>
    ),
  },
];

const kolomExport: ExportColumn<InboxItem>[] = [
  { header: "Jenis", value: (r) => LABEL[r.jenis] },
  { header: "Kode", value: (r) => r.kode },
  { header: "Perihal", value: (r) => r.judul },
  { header: "Pengaju", value: (r) => r.pengaju },
  { header: "Nominal", value: (r) => r.nominal },
  { header: "Menunggu sejak", value: (r) => r.menunggu_sejak },
  { header: "Umur (hari)", value: (r) => r.umur_hari },
  { header: "Balasan WA", value: (r) => r.aksi_wa },
];

export function InboxView({ data }: { data: InboxHasil }) {
  const [jenis, setJenis] = useState<JenisInbox | null>(null);
  const tampil = jenis ? data.items.filter((i) => i.jenis === jenis) : data.items;
  const lambat = data.items.filter((i) => i.umur_hari > HARI_LAMBAT).length;
  const diperbarui = new Date(data.generated_at).toLocaleString("id-ID", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  });

  return (
    <div className="space-y-4">
      {data.gagal.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <strong>Daftar belum lengkap.</strong> Sumber ini gagal dibaca:{" "}
          {data.gagal.map((g) => LABEL[g.jenis]).join(", ")}. Item dari sumber itu tidak tampil di bawah —
          buka menunya langsung sampai ini pulih.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setJenis(null)}
          className={cn("rounded-md border px-3 py-1.5 text-sm", jenis === null ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
        >
          Semua <span className="tabular-nums">{data.total}</span>
        </button>
        {URUT.map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => setJenis(jenis === j ? null : j)}
            className={cn("rounded-md border px-3 py-1.5 text-sm", jenis === j ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}
          >
            {LABEL[j]} <span className="tabular-nums">{data.per_jenis[j]}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {lambat > 0 ? `${lambat} menunggu > ${HARI_LAMBAT} hari · ` : ""}diperbarui {diperbarui}
        </span>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Menunggu keputusan Direktur</h2>
          <ExportButton filename="direktur-inbox" columns={kolomExport} data={tampil} label="Export CSV" />
        </div>
        <DataTable
          columns={kolom} data={tampil} getKey={(r) => `${r.jenis}:${r.id}`}
          searchPlaceholder="Cari kode, perihal, atau pengaju…" pageSize={25}
          empty="Tidak ada yang menunggu keputusan."
          initialSort={{ id: "umur", dir: "desc" }}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Halaman ini hanya membaca. Approval F11 &amp; lembur juga bisa diputuskan lewat WA (#APPROVE / #REJECT &lt;kode&gt;);
        sumber lain diputuskan di layarnya. Yang tampil: PO setelah HoD Business &amp; Finance setuju, dana operasional
        setelah HoD setuju, insentif di langkah Direktur, lembur yang tak punya HoD pemutus.
      </p>
    </div>
  );
}
