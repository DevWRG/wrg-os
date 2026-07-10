"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface HodRow {
  id: string; nama: string; dept_label: string | null; atasan_raw: string;
  hod_keys: string[]; hod_names: string[]; status: "resolved" | "ambiguous" | "none";
}
export interface HodResolution {
  rows: HodRow[];
  summary: { total: number; resolved: number; ambiguous: number; none: number };
  hods: { key: string; name: string; role: string }[];
}

const statusStyle = (s: string) =>
  s === "resolved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
  : s === "ambiguous" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
  : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300";
const statusLabel = (s: string) => (s === "resolved" ? "Resolved" : s === "ambiguous" ? "Ambigu (multi-HOD)" : "Perlu review");

// F121 — preview HoD resolution (atasan_raw → HoD kanonik). Read-only QA + foundation
// ORG_OPTIMAL. Filter status + search.
export function HodResolverView({ data }: { data: HodResolution }) {
  const [status, setStatus] = useState<"all" | "resolved" | "ambiguous" | "none">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.rows.filter((r) =>
      (status === "all" || r.status === status) &&
      (!term || r.nama.toLowerCase().includes(term) || r.atasan_raw.toLowerCase().includes(term)),
    );
  }, [data.rows, status, q]);

  const columns: DataColumn<HodRow>[] = [
    { id: "nama", header: "Karyawan", sortable: true, accessor: (r) => r.nama, cell: (r) => (<div><div className="font-medium">{r.nama}</div>{r.dept_label && <div className="text-muted-foreground text-xs">{r.dept_label}</div>}</div>) },
    { id: "atasan_raw", header: "Atasan (mentah)", sortable: true, accessor: (r) => r.atasan_raw, cell: (r) => <span className="text-muted-foreground text-xs">{r.atasan_raw || "—"}</span> },
    { id: "hod", header: "HoD (resolved)", accessor: (r) => r.hod_names.join(", "), cell: (r) => (r.hod_names.length ? r.hod_names.join(" + ") : "—") },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusStyle(r.status)}`}>{statusLabel(r.status)}</span> },
  ];

  const pct = data.summary.total ? Math.round((data.summary.resolved / data.summary.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Resolved</div><div className="mt-1 text-2xl font-bold text-emerald-600">{data.summary.resolved}</div><div className="text-muted-foreground text-xs">{pct}% dari {data.summary.total}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Ambigu (multi-HOD)</div><div className="mt-1 text-2xl font-bold text-amber-600">{data.summary.ambiguous}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Perlu review</div><div className="mt-1 text-2xl font-bold text-rose-600">{data.summary.none}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">HoD kanonik</div><div className="mt-1 text-2xl font-bold">{data.hods.length}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">HoD kanonik:</span>
        {data.hods.map((h) => <span key={h.key} className="bg-muted rounded-full px-2 py-0.5" title={h.role}>{h.name}</span>)}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1">
          {([["all", "Semua"], ["resolved", "Resolved"], ["ambiguous", "Ambigu"], ["none", "Perlu review"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setStatus(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${status === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / atasan…" className="h-8 w-56" />
      </div>

      <DataTable data={filtered} columns={columns} getKey={(r) => r.id} initialSort={{ id: "status", dir: "asc" }} pageSize={25} empty="Tidak ada baris cocok." />
    </div>
  );
}
