"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface PacingBase {
  target: number; actual: number; achievement_pct: number | null; expected: number;
  pace: number | null; projected: number; projected_pct: number | null; status: string;
}
export interface PacingAm extends PacingBase { am_id: string; nama: string; cabang: string | null }
export interface PacingCabang extends PacingBase { cabang: string }
export interface PacingData {
  year: number; elapsed_pct: number;
  am: PacingAm[]; cabang: PacingCabang[];
  summary: { am: { target: number; actual: number }; cabang: { target: number; actual: number } };
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(2)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));
const statusStyle = (s: string) =>
  s === "on-track" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
  : s === "at-risk" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
  : s === "behind" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
  : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300";
const statusLabel = (s: string) => (s === "on-track" ? "Sesuai Target" : s === "at-risk" ? "Perlu Perhatian" : s === "behind" ? "Tertinggal" : "—");

// Target Pacing — target vs actual YTD + proyeksi akhir tahun, per AM & cabang.
export function TargetPacingView({ data }: { data: PacingData }) {
  const [tab, setTab] = useState<"am" | "cabang">("am");
  const rows = tab === "am" ? data.am : data.cabang;
  const sum = tab === "am" ? data.summary.am : data.summary.cabang;
  const ach = sum.target > 0 ? Math.round((sum.actual / sum.target) * 1000) / 10 : 0;
  const pace = sum.target > 0 && data.elapsed_pct > 0 ? Math.round((sum.actual / (sum.target * (data.elapsed_pct / 100))) * 100) : null;

  const nameCol: DataColumn<PacingAm | PacingCabang> = tab === "am"
    ? { id: "nama", header: "AM", sortable: true, accessor: (r) => (r as PacingAm).nama, cell: (r) => (<div><div className="font-medium">{(r as PacingAm).nama}</div>{(r as PacingAm).cabang && <div className="text-muted-foreground text-xs">{(r as PacingAm).cabang}</div>}</div>) }
    : { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => (r as PacingCabang).cabang, cell: (r) => <span className="font-medium">{(r as PacingCabang).cabang}</span> };

  const columns: DataColumn<PacingAm | PacingCabang>[] = [
    nameCol,
    { id: "target", header: "Target", align: "right", sortable: true, accessor: (r) => r.target, cell: (r) => <span title={rpFull.format(r.target)}>{rpC(r.target)}</span> },
    { id: "actual", header: "Actual (YTD)", align: "right", sortable: true, accessor: (r) => r.actual, cell: (r) => <span title={rpFull.format(r.actual)}>{rpC(r.actual)}</span> },
    { id: "achievement_pct", header: "%Ach", align: "right", sortable: true, accessor: (r) => r.achievement_pct ?? 0, cell: (r) => (r.achievement_pct == null ? "—" : `${r.achievement_pct}%`) },
    { id: "pace", header: "Pace", align: "right", sortable: true, accessor: (r) => r.pace ?? 0, cell: (r) => (r.pace == null ? "—" : `${r.pace}%`) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusStyle(r.status)}`}>{statusLabel(r.status)}</span> },
    { id: "projected_pct", header: "Proyeksi %", align: "right", sortable: true, accessor: (r) => r.projected_pct ?? 0, cell: (r) => (r.projected_pct == null ? "—" : <span title={`proyeksi ${rpFull.format(r.projected)}`}>{r.projected_pct}%</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Tahun berjalan</div><div className="mt-1 text-2xl font-bold">{data.year}</div><div className="text-muted-foreground text-xs">{data.elapsed_pct}% periode berlalu</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Total Target</div><div className="mt-1 text-2xl font-bold" title={rpFull.format(sum.target)}>{rpC(sum.target)}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Actual YTD</div><div className="mt-1 text-2xl font-bold text-emerald-600" title={rpFull.format(sum.actual)}>{rpC(sum.actual)}</div><div className="text-muted-foreground text-xs">{ach}% dari target</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Pace agregat</div><div className={`mt-1 text-2xl font-bold ${pace == null ? "" : pace >= 100 ? "text-emerald-600" : pace >= 90 ? "text-amber-600" : "text-rose-600"}`}>{pace == null ? "—" : `${pace}%`}</div><div className="text-muted-foreground text-xs">actual vs ekspektasi to-date</div></CardContent></Card>
      </div>

      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        {([["am", "Per AM"], ["cabang", "Per Cabang"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
        ))}
      </div>

      <Card>
        <CardContent>
          <DataTable data={rows} columns={columns} getKey={(r) => ("am_id" in r ? r.am_id : r.cabang)} initialSort={{ id: "pace", dir: "asc" }} pageSize={25} empty="Belum ada target di-set utk tahun ini (menu Admin → Sales Targets)." />
          <p className="text-muted-foreground mt-3 text-xs">Pace = actual ÷ (target × {data.elapsed_pct}% periode berlalu). ≥100% Sesuai Target · 90–99% Perlu Perhatian · &lt;90% Tertinggal. Proyeksi = ekstrapolasi linear actual ke akhir tahun.</p>
        </CardContent>
      </Card>
    </div>
  );
}
