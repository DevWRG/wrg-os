"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface DormantCustomer {
  id: string; name: string; cabang: string | null; total: number; invoices: number;
  last_date: string | null; days_since: number | null; am: string | null;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(1)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));
// Aksen & warna hari sesuai keparahan dormansi.
const sevBorder = (d: number | null) => (d != null && d >= 120 ? "border-l-rose-500" : d != null && d >= 100 ? "border-l-orange-400" : "border-l-amber-400");
const sevDays = (d: number | null) => (d != null && d >= 120 ? "text-rose-600" : d != null && d >= 100 ? "text-orange-600" : "text-amber-600");

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
  const [sort, setSort] = useState<"total" | "days">("total");

  const ams = useMemo(() => [...new Set(customers.map((c) => c.am).filter(Boolean))].sort() as string[], [customers]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = customers.filter((c) =>
      (c.days_since ?? 0) >= minDays &&
      (am === "all" || c.am === am) &&
      (!term || c.name.toLowerCase().includes(term) || (c.am ?? "").toLowerCase().includes(term) || (c.cabang ?? "").toLowerCase().includes(term)),
    );
    return list.sort((a, b) => (sort === "total" ? b.total - a.total : (b.days_since ?? 0) - (a.days_since ?? 0)));
  }, [customers, minDays, am, q, sort]);

  const atRisk = useMemo(() => filtered.reduce((s, c) => s + c.total, 0), [filtered]);

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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari customer / AM / cabang…" className="h-8 w-64 bg-card border-border" />
        <div className="flex gap-1 rounded-lg border p-1">
          {([["total", "Revenue"], ["days", "Dormant"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setSort(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${sort === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
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

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">Tidak ada customer dormant di filter ini.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className={`border-l-4 ${sevBorder(c.days_since)}`}>
              <CardContent className="py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold leading-snug" title={c.name}>{c.name}</div>
                    {c.cabang && <div className="text-muted-foreground text-xs">{c.cabang}</div>}
                  </div>
                  <div className="shrink-0 text-right leading-none">
                    <div className={`text-xl font-bold tabular-nums ${sevDays(c.days_since)}`}>{c.days_since ?? "—"}</div>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">hari dormant</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
                  <div><div className="text-muted-foreground">AM (terakhir)</div><div className="truncate font-medium" title={c.am ?? undefined}>{c.am ?? "—"}</div></div>
                  <div className="text-right"><div className="text-muted-foreground">Revenue historis</div><div className="font-semibold" title={rpFull.format(c.total)}>{rpC(c.total)}</div></div>
                  <div><div className="text-muted-foreground">Order terakhir</div><div className="tabular-nums">{c.last_date ?? "—"}</div></div>
                  <div className="text-right"><div className="text-muted-foreground">Faktur</div><div className="tabular-nums">{c.invoices}</div></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
