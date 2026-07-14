"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ChurnTier = "active" | "risk" | "watch";
export interface ChurnCustomer {
  id: string; name: string; cabang: string | null; total: number; invoices: number;
  last_date: string | null; days_since: number | null; recent90: number; prior90: number;
  am: string | null; tier: ChurnTier;
}
export interface ChurnData {
  summary: { churn_days: number; routine_min: number; total: number; active: number; risk: number; watch: number; value_at_risk: number };
  customers: ChurnCustomer[];
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(1)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));

const TIER_META: Record<ChurnTier, { label: string; badge: string; dot: string; border: string }> = {
  active: { label: "🔴 Churn Aktif", badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", dot: "text-rose-600", border: "border-l-rose-400" },
  risk: { label: "🟡 Risiko Churn", badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", dot: "text-amber-600", border: "border-l-amber-400" },
  watch: { label: "⚠️ Pantau Tanpa Order", badge: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300", dot: "text-slate-500", border: "border-l-slate-300 dark:border-l-slate-600" },
};

function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([`﻿sep=,\n${body}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// F77 Customer Churn Early Warning (Fase 1 — deteksi read-only). Klasifikasi 3-tier
// dari histori faktur Accurate: active (rutin & berhenti >churn_days), risk (frekuensi
// turun >50% vs baseline 3 bln), watch (umum & berhenti). Filter tier + AM + cari + CSV.
export function ChurnView({ data }: { data: ChurnData }) {
  const [tier, setTier] = useState<"all" | ChurnTier>("all");
  const [am, setAm] = useState<string>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"days" | "total">("days");
  const { summary, customers } = data;

  const ams = useMemo(() => [...new Set(customers.map((c) => c.am).filter(Boolean))].sort() as string[], [customers]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = customers.filter((c) =>
      (tier === "all" || c.tier === tier) &&
      (am === "all" || c.am === am) &&
      (!term || c.name.toLowerCase().includes(term) || (c.am ?? "").toLowerCase().includes(term) || (c.cabang ?? "").toLowerCase().includes(term)),
    );
    return list.sort((a, b) => (sort === "days" ? (b.days_since ?? 0) - (a.days_since ?? 0) : b.total - a.total));
  }, [customers, tier, am, q, sort]);

  const exportCsv = () => downloadCsv(
    `churn_${tier}_${new Date().toISOString().slice(0, 10)}.csv`,
    ["Tier", "Pelanggan", "Cabang", "AM", "Revenue historis", "Order terakhir", "Hari tanpa order", "Total order"],
    filtered.map((c) => [TIER_META[c.tier].label, c.name, c.cabang, c.am, Math.round(c.total), c.last_date, c.days_since, c.invoices]),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {(["active", "risk", "watch"] as const).map((t) => (
          <button key={t} onClick={() => setTier((cur) => (cur === t ? "all" : t))} className="text-left">
            <Card className={tier === t ? "ring-2 ring-primary" : ""}>
              <CardContent className="py-4">
                <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{TIER_META[t].label}</div>
                <div className={`mt-1 text-2xl font-bold ${TIER_META[t].dot}`}>{summary[t]}</div>
                <div className="text-muted-foreground text-xs">pelanggan</div>
              </CardContent>
            </Card>
          </button>
        ))}
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Nilai historis (berisiko)</div><div className="mt-1 text-2xl font-bold" title={rpFull.format(summary.value_at_risk)}>{rpC(summary.value_at_risk)}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1">
          {([["all", "Semua"], ["active", "🔴 Aktif"], ["risk", "🟡 Risiko"], ["watch", "⚠️ Pantau"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTier(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${tier === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pelanggan / AM / cabang…" className="h-8 w-64 bg-card border-border" />
        <div className="flex gap-1 rounded-lg border p-1">
          {([["days", "Hari tanpa order"], ["total", "Revenue"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setSort(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${sort === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>Ekspor CSV</Button>
        <span className="text-muted-foreground text-xs">{filtered.length} pelanggan</span>
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
        <p className="text-muted-foreground text-sm">Tidak ada pelanggan churn di filter ini.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className={`border-l-4 ${TIER_META[c.tier].border}`}>
              <CardContent className="py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${TIER_META[c.tier].badge}`}>{TIER_META[c.tier].label}</span>
                  <div className="text-right leading-none">
                    <div className={`text-xl font-bold tabular-nums ${TIER_META[c.tier].dot}`}>{c.days_since ?? "—"}</div>
                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">hari tanpa order</div>
                  </div>
                </div>
                <div className="mt-2 font-semibold leading-snug" title={c.name}>{c.name}</div>
                {c.cabang && <div className="text-muted-foreground text-xs">{c.cabang}</div>}
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
                  <div><div className="text-muted-foreground">AM (terakhir)</div><div className="truncate font-medium" title={c.am ?? undefined}>{c.am ?? "—"}</div></div>
                  <div className="text-right"><div className="text-muted-foreground">Revenue historis</div><div className="font-semibold" title={rpFull.format(c.total)}>{rpC(c.total)}</div></div>
                  <div><div className="text-muted-foreground">Order terakhir</div><div className="tabular-nums">{c.last_date ?? "—"}</div></div>
                  <div className="text-right"><div className="text-muted-foreground">Total order</div><div className="tabular-nums">{c.invoices}</div></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        🔴 Churn Aktif = pelanggan rutin (≥{summary.routine_min} order) berhenti &gt;{summary.churn_days} hari · 🟡 Risiko Churn = masih order tapi frekuensi turun &gt;50% vs rata-rata 3 bulan · ⚠️ Pantau Tanpa Order = pelanggan umum berhenti &gt;{summary.churn_days} hari. Sumber: faktur Accurate. Kirim otomatis ke WA AM menyusul (Fase 2).
      </p>
    </div>
  );
}
