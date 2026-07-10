"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface DormantCustomer {
  id: string; name: string; cabang: string | null; total: number; invoices: number;
  last_date: string | null; days_since: number | null; am: string | null;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(1)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));

function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([`﻿sep=,\n${body}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

const DAY_OPTS = [30, 60, 90, 120, 180];

// F127+ Dormant Customer Win-back — customer lama yang berhenti order, prioritas
// revenue historis. Filter ambang hari + AM + cari + export CSV.
export function WinBackView({ customers }: { customers: DormantCustomer[] }) {
  const [minDays, setMinDays] = useState(60);
  const [am, setAm] = useState<string>("all");
  const [q, setQ] = useState("");

  const ams = useMemo(() => [...new Set(customers.map((c) => c.am).filter(Boolean))].sort() as string[], [customers]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return customers.filter((c) =>
      (c.days_since ?? 0) >= minDays &&
      (am === "all" || c.am === am) &&
      (!term || c.name.toLowerCase().includes(term) || (c.am ?? "").toLowerCase().includes(term) || (c.cabang ?? "").toLowerCase().includes(term)),
    );
  }, [customers, minDays, am, q]);

  const atRisk = useMemo(() => filtered.reduce((s, c) => s + c.total, 0), [filtered]);

  const columns: DataColumn<DormantCustomer>[] = [
    { id: "name", header: "Customer", sortable: true, accessor: (r) => r.name, cell: (r) => (<div><div className="font-medium">{r.name}</div>{r.cabang && <div className="text-muted-foreground text-xs">{r.cabang}</div>}</div>) },
    { id: "am", header: "AM (terakhir)", sortable: true, accessor: (r) => r.am ?? "", cell: (r) => r.am ?? <span className="text-muted-foreground">—</span> },
    { id: "total", header: "Revenue historis", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => <span title={rpFull.format(r.total)}>{rpC(r.total)}</span> },
    { id: "last_date", header: "Order terakhir", sortable: true, accessor: (r) => r.last_date ?? "", cell: (r) => r.last_date ?? "—" },
    { id: "days_since", header: "Dormant (hari)", align: "right", sortable: true, accessor: (r) => r.days_since ?? 0, cell: (r) => <span className="font-semibold text-rose-600">{r.days_since ?? "—"}</span> },
    { id: "invoices", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.invoices },
  ];

  const exportCsv = () => downloadCsv(
    `win-back_${minDays}hari_${new Date().toISOString().slice(0, 10)}.csv`,
    ["Customer", "Cabang", "AM", "Revenue historis", "Order terakhir", "Dormant (hari)", "Faktur"],
    filtered.map((c) => [c.name, c.cabang, c.am, Math.round(c.total), c.last_date, c.days_since, c.invoices]),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Dormant ≥ {minDays} hari</div><div className="mt-1 text-2xl font-bold text-rose-600">{filtered.length}</div><div className="text-muted-foreground text-xs">customer</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Nilai historis (at-risk)</div><div className="mt-1 text-2xl font-bold" title={rpFull.format(atRisk)}>{rpC(atRisk)}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">AM terlibat</div><div className="mt-1 text-2xl font-bold">{new Set(filtered.map((c) => c.am).filter(Boolean)).size}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1">
          {DAY_OPTS.map((d) => (
            <button key={d} onClick={() => setMinDays(d)} className={`rounded-md px-3 py-1 text-sm font-medium ${minDays === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>≥{d}h</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari customer / AM / cabang…" className="h-8 w-64" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
        <span className="text-muted-foreground text-xs">{filtered.length} customer</span>
      </div>

      {ams.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setAm("all")} className={`rounded-full border px-2.5 py-1 text-xs ${am === "all" ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>Semua AM</button>
          {ams.map((a) => (
            <button key={a} onClick={() => setAm(a)} className={`rounded-full border px-2.5 py-1 text-xs ${am === a ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>{a}</button>
          ))}
        </div>
      )}

      <DataTable data={filtered} columns={columns} getKey={(r) => r.id} initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada customer dormant di filter ini." />
    </div>
  );
}
