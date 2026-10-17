"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

// Pipeline Authenticity (F4 SXR) — status keaslian deal. Dihitung di server
// (apps/api/src/repo/pipeline-keaslian.ts); per hari ini, tak ikut filter tanggal.

export type StatusKeaslian = "MERAGUKAN" | "PERLU_CEK" | "TERVERIFIKASI";
export interface DealKeaslian {
  deal_id: string; stage: string; customer: string; account_id: string | null; tertaut_lewat: "akun" | "nama" | null;
  am: string; cabang: string | null; nilai: number; produk: string | null; jumlah_kunjungan_60: number; faktur_pertama: string | null;
  status: StatusKeaslian; alasan: { tingkat: "meragukan" | "cek" | "info"; kode: string; teks: string }[];
  kunjungan_terakhir: string | null; lama_tahap: number;
}
export interface AmKeaslian { am: string; total: number; terverifikasi: number; perlu_cek: number; meragukan: number; nilai_meragukan: number; persen_terverifikasi: number }
export interface KeaslianData {
  hari_ini: string;
  aturan: { tanpa_kunjungan_hari: number; won_jendela_hari: number; won_tunggu_hari: number; batas_tahap: Record<string, number> };
  ringkas: { total: number; terbuka: number; won: number; meragukan: number; perlu_cek: number; terverifikasi: number; nilai_meragukan: number; tak_tertaut: number };
  per_am: AmKeaslian[];
  deals: DealKeaslian[];
}

export const STATUS_LABEL: Record<StatusKeaslian, string> = { MERAGUKAN: "Meragukan", PERLU_CEK: "Perlu dicek", TERVERIFIKASI: "Terverifikasi" };
const CLS: Record<StatusKeaslian, string> = {
  MERAGUKAN: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  PERLU_CEK: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  TERVERIFIKASI: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
};
const URUT: StatusKeaslian[] = ["MERAGUKAN", "PERLU_CEK", "TERVERIFIKASI"];
const jt = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M` : `Rp ${Math.round(n / 1e6).toLocaleString("id-ID")} jt`);
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (iso: string | null) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${BLN[m - 1]} ${y}`; };

export function KeaslianView({ data }: { data: KeaslianData }) {
  const [status, setStatus] = useState<StatusKeaslian | "">("");
  const [am, setAm] = useState("");
  const [jenis, setJenis] = useState<"" | "terbuka" | "won">("");
  const opsiAm = useMemo(() => [...new Set(data.deals.map((d) => d.am))].sort().map((a) => ({ value: a, label: a })), [data]);
  const tampil = data.deals.filter((d) => (!status || d.status === status) && (!am || d.am === am)
    && (!jenis || (jenis === "won") === (d.stage === "Closing-Won")));
  const r = data.ringkas;
  const b = data.aturan.batas_tahap;

  const kolomDeal: DataColumn<DealKeaslian>[] = [
    { id: "deal", header: "Deal", sortable: true, accessor: (d) => d.customer, cell: (d) => (
      <div className="min-w-48">
        {d.account_id ? <Link href={`/accounts/${d.account_id}`} className="font-medium hover:underline">{d.customer}</Link> : <span className="font-medium">{d.customer}</span>}
        <div className="text-muted-foreground text-xs">{[d.stage, d.produk, d.am, d.cabang].filter(Boolean).join(" · ")}</div>
      </div>) },
    { id: "status", header: "Status", sortable: true, accessor: (d) => URUT.indexOf(d.status), cell: (d) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", CLS[d.status])}>{STATUS_LABEL[d.status]}</span>) },
    { id: "alasan", header: "Alasan", cell: (d) => d.alasan.length ? (
      <ul className="max-w-md space-y-0.5 text-sm">
        {d.alasan.map((a) => <li key={a.kode} className={cn(a.tingkat === "meragukan" && "text-rose-700 dark:text-rose-400", a.tingkat === "cek" && "text-amber-700 dark:text-amber-400", a.tingkat === "info" && "text-muted-foreground")}>{a.teks}</li>)}
      </ul>) : <span className="text-muted-foreground text-sm">—</span> },
    { id: "kunj", header: "Kunjungan", align: "right", sortable: true, accessor: (d) => d.kunjungan_terakhir ?? "", cell: (d) => (
      <div className="text-right"><div className="tabular-nums">{tgl(d.kunjungan_terakhir)}</div><div className="text-muted-foreground text-xs">{d.jumlah_kunjungan_60}× dalam {data.aturan.tanpa_kunjungan_hari} hari</div></div>) },
    { id: "nilai", header: "Estimasi", align: "right", sortable: true, accessor: (d) => d.nilai, cell: (d) => <span className="tabular-nums">{d.nilai ? jt(d.nilai) : "—"}</span> },
  ];
  const kolomAm: DataColumn<AmKeaslian>[] = [
    { id: "am", header: "AM", sortable: true, accessor: (a) => a.am, cell: (a) => (
      <button type="button" onClick={() => setAm(am === a.am ? "" : a.am)} className={cn("text-left font-medium hover:underline", am === a.am && "text-primary-dark")}>{a.am}</button>) },
    { id: "total", header: "Deal", align: "right", sortable: true, accessor: (a) => a.total, cell: (a) => <span className="tabular-nums">{a.total}</span> },
    { id: "ver", header: "Terverifikasi", align: "right", sortable: true, accessor: (a) => a.persen_terverifikasi, cell: (a) => (
      <span className={cn("tabular-nums", a.persen_terverifikasi < 0.3 && "text-rose-700 dark:text-rose-400")}>{Math.round(a.persen_terverifikasi * 100)}%</span>) },
    { id: "cek", header: "Perlu dicek", align: "right", sortable: true, accessor: (a) => a.perlu_cek, cell: (a) => <span className="tabular-nums">{a.perlu_cek}</span> },
    { id: "ragu", header: "Meragukan", align: "right", sortable: true, accessor: (a) => a.meragukan, cell: (a) => (
      <div className="text-right"><div className="tabular-nums">{a.meragukan}</div>{a.nilai_meragukan > 0 && <div className="text-muted-foreground text-xs">{jt(a.nilai_meragukan)}</div>}</div>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {URUT.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? "" : s)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", status === s && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{STATUS_LABEL[s]}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", CLS[s])}>{s === "MERAGUKAN" ? r.meragukan : s === "PERLU_CEK" ? r.perlu_cek : r.terverifikasi}</div>
            {s === "MERAGUKAN" && r.nilai_meragukan > 0 && <div className="text-muted-foreground mt-1 text-xs">estimasi {jt(r.nilai_meragukan)}</div>}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Per AM</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={kolomAm} data={data.per_am} getKey={(a) => a.am} pageSize={10} searchPlaceholder="Cari AM…" empty="Tidak ada deal dalam cakupan Anda." />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-muted-foreground text-xs">
            {r.terbuka} deal terbuka + {r.won} Won {data.aturan.won_jendela_hari} hari terakhir, per {tgl(data.hari_ini)}. <b>Perlu dicek</b> bila: tanpa laporan kunjungan {data.aturan.tanpa_kunjungan_hari} hari;
            terlalu lama di tahap (Prospecting {b.Prospecting}, Presentation/Quotation {b.Quotation}, Negotiation {b.Negotiation}, Closing {b.Closing} hari); atau kunjungan tanpa foto bergeotag.
            <b> Meragukan</b> bila tanpa kunjungan <i>dan</i> macet sekaligus, atau Won lebih dari {data.aturan.won_tunggu_hari} hari tanpa faktur Accurate. Dihitung otomatis dari data — bukan tuduhan, cek alasannya.
            {r.tak_tertaut > 0 && ` ${r.tak_tertaut} deal belum tertaut ke akun faskes (umumnya calon pelanggan) — kunjungannya dicocokkan lewat nama.`}
          </p>
          <DataTable columns={kolomDeal} data={tampil} getKey={(d) => d.deal_id} searchPlaceholder="Cari faskes…" pageSize={25}
            empty={data.deals.length === 0 ? "Tidak ada deal dalam cakupan Anda." : "Tidak ada deal dengan filter ini."}
            toolbar={<>
              <FilterSelect label="AM" value={am} onChange={setAm} options={opsiAm} />
              <FilterSelect label="Jenis" value={jenis} onChange={(v) => setJenis(v as "" | "terbuka" | "won")} options={[{ value: "terbuka", label: "Deal terbuka" }, { value: "won", label: "Won" }]} />
            </>} />
        </CardContent>
      </Card>
    </div>
  );
}
