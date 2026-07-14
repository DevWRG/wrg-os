"use client";

import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InvoiceDetailDialog } from "@/components/tables/invoice-detail-dialog";

export type ArPriority = "KRITIS" | "TINGGI" | "SEDANG" | "RENDAH";
export interface ArCustomer {
  id: string; name: string; cabang: string | null; am: string | null;
  invoices: number; total: number; current: number; b1_30: number;
  b31_60: number; b61_90: number; b90plus: number; overdue: number;
  max_overdue: number; priority: ArPriority;
}
export interface ArInvoice {
  customer_id: string; customer_name: string | null; invoice_no: string;
  due_date: string; amount: number; days_overdue: number; bucket: string; is_anomaly: boolean;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const jt = (n: number) => (n <= 0 ? "—" : Math.abs(n) >= 1e9 ? `Rp${(n / 1e9).toFixed(1)}m` : Math.abs(n) >= 1e6 ? `Rp${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));
const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return y && m && d ? `${d}/${m}/${y}` : v;
};

const PRI_CLS: Record<ArPriority, string> = {
  KRITIS: "bg-rose-600 text-white",
  TINGGI: "bg-orange-500 text-white",
  SEDANG: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  RENDAH: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};
const PRI_RANK: Record<ArPriority, number> = { KRITIS: 3, TINGGI: 2, SEDANG: 1, RENDAH: 0 };
const PRIS: ArPriority[] = ["KRITIS", "TINGGI", "SEDANG", "RENDAH"];

function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([`﻿sep=,\n${body}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// F30 AR Aging per Customer — tabel breakdown 5 bucket + prioritas tagih; klik baris
// → dialog rincian invoice customer (dari list ar_aging_mv yg sudah di-load).
export function ArByCustomerView({ customers, invoices }: { customers: ArCustomer[]; invoices: ArInvoice[] }) {
  const [pri, setPri] = useState<"all" | ArPriority>("all");
  const [sel, setSel] = useState<ArCustomer | null>(null);
  const [detailNo, setDetailNo] = useState<string | null>(null);

  const filtered = useMemo(() => (pri === "all" ? customers : customers.filter((c) => c.priority === pri)), [customers, pri]);

  const num = (n: number) => <span className={cn("tabular-nums whitespace-nowrap", n <= 0 && "text-muted-foreground")}>{jt(n)}</span>;
  const columns: DataColumn<ArCustomer>[] = [
    { id: "name", header: "Customer", sortable: true, accessor: (r) => r.name, cell: (r) => (<div><div className="max-w-[14rem] truncate font-medium" title={r.name}>{r.name}</div>{r.cabang && <div className="text-muted-foreground text-xs">{r.cabang}</div>}</div>) },
    { id: "am", header: "AM", sortable: true, accessor: (r) => r.am ?? "", cell: (r) => <span className="text-muted-foreground whitespace-nowrap">{r.am ?? "—"}</span> },
    { id: "current", header: "Current", align: "right", sortable: true, accessor: (r) => r.current, cell: (r) => num(r.current) },
    { id: "b1_30", header: "1-30", align: "right", sortable: true, accessor: (r) => r.b1_30, cell: (r) => num(r.b1_30) },
    { id: "b31_60", header: "31-60", align: "right", sortable: true, accessor: (r) => r.b31_60, cell: (r) => num(r.b31_60) },
    { id: "b61_90", header: "61-90", align: "right", sortable: true, accessor: (r) => r.b61_90, cell: (r) => <span className="text-orange-600 tabular-nums whitespace-nowrap">{r.b61_90 > 0 ? jt(r.b61_90) : "—"}</span> },
    { id: "b90plus", header: "90+", align: "right", sortable: true, accessor: (r) => r.b90plus, cell: (r) => <span className="font-semibold text-rose-600 tabular-nums whitespace-nowrap">{r.b90plus > 0 ? jt(r.b90plus) : "—"}</span> },
    { id: "total", header: "Total", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => <span className="font-semibold tabular-nums whitespace-nowrap">{jt(r.total)}</span> },
    { id: "priority", header: "Prioritas", sortable: true, accessor: (r) => PRI_RANK[r.priority], cell: (r) => <span className={cn("inline-block rounded px-2 py-0.5 text-[11px] font-semibold", PRI_CLS[r.priority])}>{r.priority}</span> },
  ];

  const exportCsv = () => downloadCsv(
    `ar-aging-per-customer_${new Date().toISOString().slice(0, 10)}.csv`,
    ["Customer", "Cabang", "AM", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Umur tertua (hari)", "Prioritas"],
    filtered.map((c) => [c.name, c.cabang, c.am, Math.round(c.current), Math.round(c.b1_30), Math.round(c.b31_60), Math.round(c.b61_90), Math.round(c.b90plus), Math.round(c.total), c.max_overdue, c.priority]),
  );

  const detail = useMemo(
    () => (sel ? invoices.filter((i) => i.customer_id === sel.id).sort((a, b) => b.days_overdue - a.days_overdue) : []),
    [sel, invoices],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        getKey={(c) => c.id}
        searchPlaceholder="Cari customer / AM…"
        pageSize={25}
        initialSort={{ id: "total", dir: "desc" }}
        onRowClick={setSel}
        empty="Tidak ada piutang di filter ini."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border p-1">
              {(["all", ...PRIS] as const).map((k) => (
                <button key={k} onClick={() => setPri(k)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", pri === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{k === "all" ? "Semua" : k}</button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}>
              <FileDown className="size-3.5" /> Ekspor CSV
            </Button>
          </div>
        }
      />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Piutang · {sel.cabang ?? "—"} · AM {sel.am ?? "—"}</div>
                <DialogTitle className="break-words">{sel.name}</DialogTitle>
                <div className="text-muted-foreground text-sm">Total {rpFull.format(sel.total)} · {sel.invoices} invoice · umur tertua {sel.max_overdue} hari</div>
              </DialogHeader>
              <DialogBody>
                <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Rincian invoice</div>
                {detail.length === 0 ? (
                  <div className="text-muted-foreground py-2 text-xs">Tidak ada rincian invoice.</div>
                ) : (
                  <div className="space-y-1.5">
                    {detail.map((i) => (
                      <button key={i.invoice_no} onClick={() => setDetailNo(i.invoice_no)} className="hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md border-b px-1.5 py-1.5 text-left text-sm last:border-0">
                        <div className="min-w-0">
                          <div className="font-medium">{i.invoice_no}</div>
                          <div className="text-muted-foreground text-xs">jatuh tempo {tgl(i.due_date)} · {i.days_overdue > 0 ? `${i.days_overdue} hari lewat` : "belum jatuh tempo"}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="tabular-nums">{rpFull.format(i.amount)}</div>
                          <div className={cn("text-xs", i.bucket === "90+" ? "text-rose-600 font-semibold" : i.bucket === "61-90" ? "text-orange-600" : "text-muted-foreground")}>{i.bucket}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </DialogBody>
            </>
          )}
        </DialogContent>
      </Dialog>

      <InvoiceDetailDialog no={detailNo} onClose={() => setDetailNo(null)} />
    </>
  );
}
