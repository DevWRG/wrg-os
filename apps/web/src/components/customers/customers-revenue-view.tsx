"use client";

import { useMemo, useState } from "react";
import { Loader2, Users2, MoonStar, Wallet, Flame, FileDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Priority = "AKTIF" | "MONITOR" | "TINGGI" | "KRITIS";
interface CustomerRow {
  id: string;
  name: string;
  cabang: string | null;
  total: number;
  invoices: number;
  last_date: string | null;
  days_since: number | null;
  m2: number;
  m1: number;
  m0: number;
  ytd: number[];
  this_month: number;
  this_month_inv: number;
  priority: Priority;
  dormant: boolean;
}
export interface CustomersRevenue {
  dormant_days: number;
  months: [string, string, string];
  ytd_months: string[];
  summary: { total_customers: number; active: number; dormant: number; kritis: number; tinggi: number; revenue_total: number; revenue_month: number; invoices_month: number };
  customers: CustomerRow[];
}
interface Monthly {
  name: string | null;
  monthly: { month: string; total: number; count: number }[];
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const jt = (n: number) => (n <= 0 ? "—" : "Rp" + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n).replace(/\s/g, "").toLowerCase());
const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return y && m && d ? `${d}/${m}/${y}` : v;
};
const mlabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${bln[Number(m) - 1] ?? m} ${String(y).slice(2)}`;
};

const PRI_CLS: Record<Priority, string> = {
  KRITIS: "bg-red-700 text-white",
  TINGGI: "bg-orange-500 text-white",
  MONITOR: "bg-amber-700 text-white",
  AKTIF: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};
function PriBadge({ p }: { p: Priority }) {
  return <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold tracking-wide", PRI_CLS[p])}>{p}</span>;
}
const hariCls = (p: Priority) => (p === "KRITIS" ? "font-semibold text-red-600" : p === "TINGGI" ? "font-semibold text-orange-600" : "text-muted-foreground");

function Stat({ icon: Icon, chip, label, value, sub }: { icon: typeof Wallet; chip: string; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2.5">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", chip)}><Icon className="size-4" /></div>
          <span className="text-muted-foreground text-xs leading-tight font-medium">{label}</span>
        </div>
        <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function CustomersRevenueView({ data }: { data: CustomersRevenue }) {
  const [dormantOnly, setDormantOnly] = useState(false);
  const [sel, setSel] = useState<CustomerRow | null>(null);
  const [monthly, setMonthly] = useState<Monthly | null>(null);
  const [err, setErr] = useState(false);

  const rows = useMemo(() => (dormantOnly ? data.customers.filter((c) => c.dormant) : data.customers), [data.customers, dormantOnly]);

  function openDetail(c: CustomerRow) {
    setSel(c);
    setMonthly(null);
    setErr(false);
    fetch(`/api/customers/${encodeURIComponent(c.id)}/monthly?months=12`)
      .then((r) => r.json())
      .then((d: Monthly) => setMonthly(d))
      .catch(() => setErr(true));
  }

  const [mL2, mL1, mL0] = data.months;

  // Export CSV (UTF-8 BOM → Excel buka langsung, kolom kepisah). Angka mentah
  // (rupiah penuh) biar bisa di-sum/sort; ikut filter dormant yg aktif.
  function exportCsv() {
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = ["Customer", "Cabang", "Last Order", "Hari", "Omzet", ...data.ytd_months, "Faktur", "Prioritas", "Dormant"];
    const lines = rows.map((c) =>
      [c.name, c.cabang ?? "", tgl(c.last_date), c.days_since ?? "", c.total, ...c.ytd, c.invoices, c.priority, c.dormant ? "Ya" : "Tidak"]
        .map(esc)
        .join(","),
    );
    const csv = "﻿" + [headers.map(esc).join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `customers-revenue-${dormantOnly ? "dormant-" : ""}${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthCell = (v: number) => <span className="tabular-nums whitespace-nowrap text-sky-600 dark:text-sky-400">{jt(v)}</span>;
  const columns: DataColumn<CustomerRow>[] = [
    { id: "name", header: "Customer", sortable: true, accessor: (c) => c.name, cell: (c) => <span className={cn("block max-w-[15rem] truncate font-medium", c.priority === "KRITIS" && "text-red-600")} title={c.name}>{c.name}</span>, className: "max-w-[15rem]" },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (c) => c.cabang ?? "", cell: (c) => <span className="text-muted-foreground block max-w-[7.5rem] truncate" title={c.cabang ?? undefined}>{c.cabang ?? "—"}</span>, className: "max-w-[7.5rem]" },
    { id: "last", header: "Last Order", sortable: true, accessor: (c) => c.last_date ?? "", cell: (c) => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{tgl(c.last_date)}</span>, className: "whitespace-nowrap" },
    { id: "hari", header: "Hari", align: "right", sortable: true, accessor: (c) => c.days_since ?? -1, cell: (c) => <span className={cn("tabular-nums whitespace-nowrap", hariCls(c.priority))}>{c.days_since != null ? `${c.days_since}h` : "—"}</span>, className: "whitespace-nowrap" },
    { id: "omzet", header: "Omzet", align: "right", sortable: true, accessor: (c) => c.total, cell: (c) => <span className="font-semibold tabular-nums whitespace-nowrap">{jt(c.total)}</span>, className: "whitespace-nowrap" },
    { id: "m2", header: mL2, align: "right", sortable: true, accessor: (c) => c.m2, cell: (c) => monthCell(c.m2), className: "whitespace-nowrap" },
    { id: "m1", header: mL1, align: "right", sortable: true, accessor: (c) => c.m1, cell: (c) => monthCell(c.m1), className: "whitespace-nowrap" },
    { id: "m0", header: mL0, align: "right", sortable: true, accessor: (c) => c.m0, cell: (c) => monthCell(c.m0), className: "whitespace-nowrap" },
    { id: "priority", header: "Prioritas", sortable: true, accessor: (c) => ({ KRITIS: 3, TINGGI: 2, MONITOR: 1, AKTIF: 0 })[c.priority], cell: (c) => <PriBadge p={c.priority} /> },
  ];

  const maxMonth = monthly ? Math.max(1, ...monthly.monthly.map((m) => m.total)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users2} chip="bg-primary-soft text-primary" label="Total Customer" value={String(data.summary.total_customers)} sub={`${data.summary.active} aktif · ${data.summary.dormant} dormant`} />
        <Stat icon={Flame} chip="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" label="KRITIS (>120 hari)" value={String(data.summary.kritis)} sub="prioritas follow-up" />
        <Stat icon={MoonStar} chip="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" label={`Dormant >${data.dormant_days} hari`} value={String(data.summary.dormant)} sub={`${data.summary.tinggi} tinggi (100–120h)`} />
        <Stat icon={Wallet} chip="bg-info-soft text-info" label="Revenue Bulan Ini" value={jt(data.summary.revenue_month)} sub={`${data.summary.invoices_month} faktur`} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={rows}
            getKey={(c) => c.id}
            searchPlaceholder="Cari customer / cabang…"
            pageSize={25}
            onRowClick={openDetail}
            toolbar={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <FileDown className="size-3.5" /> Export Excel
                </Button>
                <Button size="sm" variant={dormantOnly ? "default" : "outline"} onClick={() => setDormantOnly((v) => !v)}>
                  <MoonStar className="size-3.5" /> Dormant &gt;{data.dormant_days}h ({data.summary.dormant})
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Customer · {sel.cabang ?? "—"}</div>
                <DialogTitle className="break-words">{sel.name}</DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <PriBadge p={sel.priority} />
                  <span className="text-muted-foreground">Omzet {rp(sel.total)} · {sel.invoices} faktur · terakhir {tgl(sel.last_date)} ({sel.days_since}h)</span>
                </div>
              </DialogHeader>
              <DialogBody>
                <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Revenue per Bulan (12 bln terakhir)</div>
                {monthly === null && !err ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs"><Loader2 className="size-3.5 animate-spin" /> Memuat…</div>
                ) : err ? (
                  <div className="text-muted-foreground py-2 text-xs">Gagal memuat rincian.</div>
                ) : monthly!.monthly.length === 0 ? (
                  <div className="text-muted-foreground py-2 text-xs">Tidak ada transaksi.</div>
                ) : (
                  <div className="space-y-2">
                    {monthly!.monthly.map((m) => (
                      <div key={m.month}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="text-muted-foreground w-16 shrink-0">{mlabel(m.month)}</span>
                          <span className="ml-auto shrink-0 tabular-nums">{rp(m.total)}</span>
                          <span className="text-muted-foreground w-14 shrink-0 text-right text-xs">{m.count} fk</span>
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                          <div className="bg-primary h-full rounded-full" style={{ width: `${(m.total / maxMonth) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DialogBody>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
