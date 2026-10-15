"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { FilterSelect } from "@/components/ui/filter-select";
import type { PmfScorecard, PmfSel, PmfStatus } from "./types";

const VARIAN: Record<PmfStatus, "default" | "secondary" | "destructive" | "outline"> = {
  MENANG: "default",
  NETRAL: "secondary",
  KALAH: "destructive",
  "DATA KURANG": "outline",
};

const persen = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("id-ID")}%`);
const poin = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID")} poin`);

const kolom = (judulKedua: string): DataColumn<PmfSel>[] => [
  { id: "brand", header: "Brand", sortable: true, accessor: (r) => r.brand },
  { id: "region", header: judulKedua, sortable: true, accessor: (r) => r.region },
  { id: "n", header: "n deal", align: "right", sortable: true, accessor: (r) => r.n },
  { id: "won", header: "Won", align: "right", sortable: true, accessor: (r) => r.won },
  { id: "lost", header: "Lost", align: "right", sortable: true, accessor: (r) => r.lost },
  {
    id: "win_rate", header: "Win-rate", align: "right", sortable: true,
    accessor: (r) => r.win_rate, cell: (r) => persen(r.win_rate),
  },
  {
    id: "selisih", header: "vs portofolio", align: "right", sortable: true,
    accessor: (r) => r.selisih_poin, cell: (r) => poin(r.selisih_poin),
  },
  {
    id: "status", header: "Status", sortable: true, accessor: (r) => r.status,
    cell: (r) => <Badge variant={VARIAN[r.status]}>{r.status}</Badge>,
  },
  {
    id: "tanpa_alasan", header: "Lost tanpa alasan", align: "right", sortable: true,
    accessor: (r) => r.lost_tanpa_alasan,
  },
];

const kolomExport: ExportColumn<PmfSel>[] = [
  { header: "Brand", value: (r) => r.brand },
  { header: "Region", value: (r) => r.region },
  { header: "n deal", value: (r) => r.n },
  { header: "Won", value: (r) => r.won },
  { header: "Lost", value: (r) => r.lost },
  { header: "Win-rate (%)", value: (r) => r.win_rate },
  { header: "Selisih vs portofolio (poin)", value: (r) => r.selisih_poin },
  { header: "Status", value: (r) => r.status },
  { header: "Lost tanpa alasan", value: (r) => r.lost_tanpa_alasan },
];

function Kartu({ label, nilai, catatan }: { label: string; nilai: string; catatan?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{nilai}</div>
      {catatan ? <div className="mt-0.5 text-xs text-muted-foreground">{catatan}</div> : null}
    </div>
  );
}

export function PmfView({ data }: { data: PmfScorecard }) {
  const router = useRouter();
  const r = data.ringkasan;
  const tahunIni = new Date().getFullYear();
  const tahunOpsi = [tahunIni, tahunIni - 1, tahunIni - 2, tahunIni - 3].map((t) => ({ value: String(t), label: String(t) }));
  const kuartalOpsi = [1, 2, 3, 4].map((k) => ({ value: String(k), label: `Q${k}` }));
  const pindah = (tahun: string, kuartal: string) => router.push(`/pmf-scorecard?tahun=${tahun}&kuartal=${kuartal}`);
  const namaFile = `pmf-scorecard-${data.tahun}-Q${data.kuartal}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Tahun" value={String(data.tahun)} onChange={(v) => v && pindah(v, String(data.kuartal))} options={tahunOpsi} semua={String(data.tahun)} />
        <FilterSelect label="Kuartal" value={String(data.kuartal)} onChange={(v) => v && pindah(String(data.tahun), v)} options={kuartalOpsi} semua={`Q${data.kuartal}`} />
        <span className="text-xs text-muted-foreground">
          {data.periode.dari} s/d {data.periode.sampai} · tanggal tutup = log perpindahan stage
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kartu label="Deal tertutup (dihitung)" nilai={String(r.n)} catatan={`${r.won} won · ${r.lost} lost`} />
        <Kartu label="Win-rate portofolio" nilai={persen(r.win_rate)} catatan="pembanding status tiap sel" />
        <Kartu label="Lost tanpa alasan" nilai={String(r.lost_tanpa_alasan)} catatan="ditampilkan apa adanya" />
        <Kartu
          label="Dikeluarkan / tanpa region"
          nilai={`${r.impor_dikeluarkan} / ${r.tanpa_region}`}
          catatan={`impor pameran / region tak terpetakan${r.tanggal_fallback ? ` · ${r.tanggal_fallback} tanggal fallback` : ""}`}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Status: n &lt; {data.ambang.min_deal} = DATA KURANG; MENANG bila win-rate ≥ portofolio +{data.ambang.poin} poin,
        KALAH bila ≤ −{data.ambang.poin} poin, selain itu NETRAL. Deal impor pameran tidak ikut dihitung. Region hanya
        East/West; sisanya &quot;Tanpa region&quot;.
      </p>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Brand × region</h2>
          <ExportButton filename={namaFile} columns={kolomExport} data={data.sel} label="Export CSV" />
        </div>
        <DataTable columns={kolom("Region")} data={data.sel} getKey={(s) => `${s.brand}|${s.region}`}
          searchPlaceholder="Cari brand atau region…" pageSize={25} empty="Belum ada deal tertutup pada kuartal ini."
          initialSort={{ id: "n", dir: "desc" }} />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Per brand (semua region)</h2>
          <ExportButton filename={`${namaFile}-per-brand`} columns={kolomExport} data={data.per_brand} label="Export CSV" />
        </div>
        <DataTable columns={kolom("Cakupan")} data={data.per_brand} getKey={(s) => s.brand}
          searchPlaceholder="Cari brand…" pageSize={25} empty="Belum ada deal tertutup pada kuartal ini."
          initialSort={{ id: "n", dir: "desc" }} />
      </section>
    </div>
  );
}
