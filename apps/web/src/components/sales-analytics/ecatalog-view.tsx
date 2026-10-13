"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

// F72 E-Catalog Recovery Watch. Penanda e-katalog = awalan nomor faktur PJE
// (label pengadaan ECAT berhenti dipakai sejak Jun 2026). Status per hari ini,
// tak ikut filter tanggal tab lain. Data: apps/api/src/repo/ecatalog-watch.ts.

export type StatusEcat = "aktif" | "waspada" | "berisiko" | "kolaps" | "pindah_jalur";
export interface FaskesEcat {
  customer_id: string; nama: string;
  pje_terakhir: string; hari_sejak_pje: number; pje_faktur: number; pje_netto: number; pje_nomor_terakhir: string;
  non_pje_terakhir: string | null; hari_sejak_non_pje: number | null; non_pje_netto_90h: number;
  am_id: string | null; am_nama: string | null; cabang: string | null; pje_tahun_lalu_netto: number; status: StatusEcat;
}
export interface EcatalogData {
  prefix: string; jendela_bulan: number; ringkasan: Record<StatusEcat, number>; total_faskes: number;
  faskes: FaskesEcat[]; tren: { bulan: string; faktur: number; faskes: number; netto: number; netto_tahun_lalu: number }[];
}

export const STATUS_LABEL: Record<StatusEcat, string> = {
  aktif: "Aktif (≤30 hari)", waspada: "Waspada (31–60)", berisiko: "Berisiko (61–90)", kolaps: "Kolaps (>90)", pindah_jalur: "Pindah jalur",
};
const STATUS_CLS: Record<StatusEcat, string> = {
  aktif: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  waspada: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  berisiko: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
  kolaps: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  pindah_jalur: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};
const URUTAN: StatusEcat[] = ["kolaps", "berisiko", "pindah_jalur", "waspada", "aktif"];

const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number) => rp.format(n || 0);
const fmtJt = (n: number) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1e6).toLocaleString("id-ID")} jt`);
const tglId = (iso: string | null) => iso ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")) : "—";
const blnId = (ym: string) => new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(ym + "-01T00:00:00Z"));

export function EcatalogView({ data }: { data: EcatalogData }) {
  const [status, setStatus] = useState<StatusEcat | "">("");
  const baris = useMemo(() => (status ? data.faskes.filter((f) => f.status === status) : data.faskes), [data.faskes, status]);

  const columns: DataColumn<FaskesEcat>[] = [
    { id: "faskes", header: "Faskes", sortable: true, accessor: (r) => r.nama, cell: (r) => (
      <div><div className="font-medium">{r.nama}</div><div className="text-muted-foreground text-xs">{r.pje_nomor_terakhir}</div></div>) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => URUTAN.indexOf(r.status), cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span>) },
    { id: "terakhir", header: "E-katalog terakhir", sortable: true, accessor: (r) => r.hari_sejak_pje, cell: (r) => (
      <div className="text-sm tabular-nums">{tglId(r.pje_terakhir)}<div className="text-muted-foreground text-xs">{r.hari_sejak_pje} hari lalu</div></div>) },
    { id: "pje", header: `E-katalog ${data.jendela_bulan} bln`, align: "right", sortable: true, accessor: (r) => r.pje_netto, cell: (r) => (
      <div className="text-sm tabular-nums">{fmtJt(r.pje_netto)}<div className="text-muted-foreground text-xs">{r.pje_faktur} faktur</div></div>) },
    { id: "lalu", header: "Periode sama thn lalu", align: "right", sortable: true, accessor: (r) => r.pje_tahun_lalu_netto, cell: (r) => (
      <span className="text-sm tabular-nums">{r.pje_tahun_lalu_netto ? fmtJt(r.pje_tahun_lalu_netto) : "—"}</span>) },
    { id: "lain", header: "Jalur lain", sortable: true, accessor: (r) => r.hari_sejak_non_pje ?? 9999, cell: (r) => r.non_pje_terakhir
      ? <div className="text-sm tabular-nums">{tglId(r.non_pje_terakhir)}<div className="text-muted-foreground text-xs">{r.non_pje_netto_90h ? `${fmtJt(r.non_pje_netto_90h)} / 90 hari` : `${r.hari_sejak_non_pje} hari lalu`}</div></div>
      : <span className="text-muted-foreground text-sm">—</span> },
    { id: "am", header: "AM", sortable: true, accessor: (r) => r.am_nama ?? "", cell: (r) => (
      <div className="text-sm">{r.am_nama ?? <span className="text-muted-foreground">tanpa AM</span>}{r.cabang && <div className="text-muted-foreground text-xs">{r.cabang}</div>}</div>) },
  ];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Faskes yang membeli lewat <b>e-katalog</b> (faktur bernomor <code>{data.prefix}-…</code>) dalam {data.jendela_bulan} bulan terakhir, menurut lama sejak pembelian e-katalog terakhir.
        Status dihitung <b>per hari ini</b> — tidak ikut filter tanggal di atas. <b>Pindah jalur</b> = e-katalognya berhenti lebih dari 60 hari tapi faskesnya masih membeli lewat jalur lain (REGULAR/KSO) dalam 60 hari terakhir.
        Sebagian faskes hanya membeli e-katalog di akhir tahun (siklus anggaran) — mereka tampil <b>kolaps</b> sampai kuartal IV; cek kolom <b>Periode sama thn lalu</b> sebelum menyimpulkan pelanggan hilang.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {URUTAN.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? "" : s)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", status === s && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{STATUS_LABEL[s]}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", STATUS_CLS[s])}>{data.ringkasan[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Penjualan e-katalog per bulan</CardTitle>
          <p className="text-muted-foreground text-xs">Netto (tanpa PPN), dibanding bulan yang sama tahun lalu — e-katalog memuncak di akhir tahun mengikuti siklus anggaran faskes, jadi jangan dibandingkan dengan bulan sebelumnya.</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.tren.map((t) => ({ ...t, label: blnId(t.bulan) }))}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis tickFormatter={(v) => fmtJt(Number(v))} fontSize={11} width={60} />
              <Tooltip formatter={(v, n) => [fmtRp(Number(v)), n === "netto" ? "Tahun ini" : "Tahun lalu"]} labelFormatter={(l) => String(l)} />
              <Legend formatter={(v) => (v === "netto" ? "Tahun ini" : "Tahun lalu")} />
              <Bar dataKey="netto_tahun_lalu" fill="#94a3b8" />
              <Bar dataKey="netto" fill="#2563a8" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={baris}
            getKey={(r) => r.customer_id}
            searchPlaceholder="Cari faskes / AM…"
            pageSize={25}
            initialSort={{ id: "status", dir: "asc" }}
            empty={data.total_faskes === 0 ? "Belum ada faktur e-katalog dalam jendela ini." : "Tidak ada faskes dengan status ini."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
