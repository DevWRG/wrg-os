"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

// F73 — kesehatan KSO per faskes (apps/api/src/repo/kso-kesehatan.ts). Status &
// alasan dihitung di server; di sini hanya menyaring & menampilkan.

export type StatusKesehatan = "SEHAT" | "WASPADA" | "KRITIS";
export interface FaskesKesehatan {
  account_id: string;
  nama: string;
  cabang: string | null;
  pemilik: string | null;
  aset: number;
  skema: string[];
  alat: string[];
  status: StatusKesehatan;
  alasan: { tingkat: "kritis" | "waspada" | "info"; kode: string; teks: string }[];
  utilisasi: { rasio: number | null; sumber: "accurate" | "sheet" | null; rata_tes: number | null };
  target_bln: number;
  rev3: number;
  rev3_sebelum: number;
}
export interface DataKesehatan {
  hari_ini: string;
  jendela: { beli: [string, string]; tes_tertagih: [string, string] };
  sheet_sampai: string | null;
  ringkas: { total: number; kritis: number; waspada: number; sehat: number };
  faskes: FaskesKesehatan[];
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const bln = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${BULAN[m - 1]} ${y}`; };
const rp = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M` : `Rp ${Math.round(n / 1e6).toLocaleString("id-ID")} jt`);

const KARTU: { s: StatusKesehatan; l: string; cls: string }[] = [
  { s: "KRITIS", l: "Kritis", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300" },
  { s: "WASPADA", l: "Waspada", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  { s: "SEHAT", l: "Sehat", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
];
const CLS = Object.fromEntries(KARTU.map((k) => [k.s, k.cls])) as Record<StatusKesehatan, string>;

export function KsoKesehatanPanel({ data }: { data: DataKesehatan | null }) {
  const [status, setStatus] = useState<StatusKesehatan | "">("");
  const [cabang, setCabang] = useState("");
  const opsiCabang = useMemo(() => [...new Set((data?.faskes ?? []).map((f) => f.cabang).filter((c): c is string => !!c))].sort().map((c) => ({ value: c, label: c })), [data]);

  if (!data) return <p className="text-muted-foreground text-sm">Data kesehatan tidak tersedia — coba muat ulang.</p>;
  const tampil = data.faskes.filter((f) => (!status || f.status === status) && (!cabang || f.cabang === cabang));

  const kolom: DataColumn<FaskesKesehatan>[] = [
    { id: "faskes", header: "Faskes", sortable: true, accessor: (f) => f.nama, cell: (f) => (
      <div>
        <Link href={`/accounts/${f.account_id}`} className="font-medium hover:underline">{f.nama}</Link>
        <div className="text-muted-foreground text-xs">{[f.cabang, f.pemilik ? `AM ${f.pemilik}` : "belum ada pemilik", `${f.aset} alat`].filter(Boolean).join(" · ")}</div>
      </div>) },
    { id: "status", header: "Status", sortable: true, accessor: (f) => ["KRITIS", "WASPADA", "SEHAT"].indexOf(f.status), cell: (f) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", CLS[f.status])}>{f.status}</span>) },
    { id: "alasan", header: "Alasan", cell: (f) => f.alasan.length ? (
      <ul className="max-w-md space-y-0.5 text-sm">
        {f.alasan.map((a) => (
          <li key={a.kode} className={cn(a.tingkat === "kritis" && "text-rose-700 dark:text-rose-400", a.tingkat === "waspada" && "text-amber-700 dark:text-amber-400", a.tingkat === "info" && "text-muted-foreground")}>{a.teks}</li>
        ))}
      </ul>) : <span className="text-muted-foreground text-sm">—</span> },
    { id: "util", header: "Utilisasi", align: "right", sortable: true, accessor: (f) => f.utilisasi.rasio ?? -1, cell: (f) => f.utilisasi.rasio == null
      ? <span className="text-muted-foreground text-xs">{f.target_bln > 0 ? "tak terukur" : "tanpa target"}</span>
      : <div className="text-right"><div className="font-medium tabular-nums">{Math.round(f.utilisasi.rasio * 100)}%</div>
          <div className="text-muted-foreground text-xs">{f.utilisasi.sumber === "sheet" ? "data sheet" : "tertagih"}</div></div> },
    { id: "rev", header: "Revenue KSO 3 bln", align: "right", sortable: true, accessor: (f) => f.rev3, cell: (f) => (
      <div className="text-right"><div className="tabular-nums">{rp(f.rev3)}</div>
        {f.rev3_sebelum > 0 && <div className="text-muted-foreground text-xs">sebelumnya {rp(f.rev3_sebelum)}</div>}</div>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {KARTU.map((k) => (
          <button key={k.s} type="button" onClick={() => setStatus(status === k.s ? "" : k.s)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", status === k.s && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{k.l}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", k.cls)}>
              {k.s === "KRITIS" ? data.ringkas.kritis : k.s === "WASPADA" ? data.ringkas.waspada : data.ringkas.sehat}
            </div>
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-muted-foreground text-xs">
            Pembelian KSO dicek untuk {bln(data.jendela.beli[0])}–{bln(data.jendela.beli[1])}; utilisasi = tes tertagih Accurate periode {bln(data.jendela.tes_tertagih[0])}–{bln(data.jendela.tes_tertagih[1])} dibanding target tes/bln
            {data.sheet_sampai ? ` (cadangan: data sheet, terakhir ${bln(data.sheet_sampai)})` : ""}. Klik nama faskes untuk briefing &amp; timeline.
          </p>
          <DataTable columns={kolom} data={tampil} getKey={(f) => f.account_id} searchPlaceholder="Cari faskes…" pageSize={25}
            empty={data.faskes.length === 0 ? "Tidak ada faskes KSO dalam cakupan Anda." : "Tidak ada faskes dengan filter ini."}
            toolbar={<FilterSelect label="Cabang" value={cabang} onChange={setCabang} options={opsiCabang} />} />
        </CardContent>
      </Card>
    </div>
  );
}
