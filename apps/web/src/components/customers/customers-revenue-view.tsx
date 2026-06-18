"use client";

import { useMemo, useState } from "react";
import { Loader2, Users2, CircleCheck, MoonStar, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

interface CustomerRow {
  id: string;
  name: string;
  total: number;
  invoices: number;
  last_date: string | null;
  days_since: number | null;
  this_month: number;
  this_month_inv: number;
  dormant: boolean;
}
export interface CustomersRevenue {
  dormant_days: number;
  summary: { total_customers: number; active: number; dormant: number; revenue_total: number; revenue_month: number; invoices_month: number };
  customers: CustomerRow[];
}
interface Monthly {
  name: string | null;
  monthly: { month: string; total: number; count: number }[];
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const rpC = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return y && m && d ? `${d} ${bln[Number(m) - 1] ?? m} ${y}` : v;
};
const mlabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${bln[Number(m) - 1] ?? m} ${String(y).slice(2)}`;
};

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

  const columns: DataColumn<CustomerRow>[] = [
    { id: "name", header: "Customer", sortable: true, accessor: (c) => c.name, cell: (c) => <span className="block max-w-[24rem] truncate font-medium" title={c.name}>{c.name}</span>, className: "max-w-[24rem]" },
    { id: "invoices", header: "Faktur", align: "right", sortable: true, accessor: (c) => c.invoices, className: "whitespace-nowrap" },
    { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (c) => c.total, cell: (c) => <span className="font-medium whitespace-nowrap">{rp(c.total)}</span>, className: "whitespace-nowrap" },
    { id: "this_month", header: "Bulan Ini", align: "right", sortable: true, accessor: (c) => c.this_month, cell: (c) => <span className={cn("whitespace-nowrap tabular-nums", c.this_month > 0 ? "text-success font-medium" : "text-muted-foreground")}>{c.this_month > 0 ? rp(c.this_month) : "—"}</span>, className: "whitespace-nowrap" },
    { id: "last", header: "Transaksi Terakhir", sortable: true, accessor: (c) => c.last_date ?? "", cell: (c) => <span className="whitespace-nowrap">{tgl(c.last_date)}{c.days_since != null && <span className="text-muted-foreground text-xs"> · {c.days_since}h lalu</span>}</span>, className: "whitespace-nowrap" },
    { id: "status", header: "Status", sortable: true, accessor: (c) => (c.dormant ? 1 : 0), cell: (c) => (c.dormant ? <Badge variant="destructive">Dormant</Badge> : <Badge variant="secondary">Aktif</Badge>) },
  ];

  const maxMonth = monthly ? Math.max(1, ...monthly.monthly.map((m) => m.total)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users2} chip="bg-primary-soft text-primary" label="Total Customer" value={String(data.summary.total_customers)} sub="pernah transaksi" />
        <Stat icon={CircleCheck} chip="bg-success-soft text-success" label="Aktif" value={String(data.summary.active)} sub={`transaksi ≤ ${data.dormant_days} hari`} />
        <Stat icon={MoonStar} chip="bg-danger-soft text-danger" label={`Dormant > ${data.dormant_days} hari`} value={String(data.summary.dormant)} sub="perlu di-follow up" />
        <Stat icon={Wallet} chip="bg-info-soft text-info" label="Revenue Bulan Ini" value={rpC(data.summary.revenue_month)} sub={`${data.summary.invoices_month} faktur`} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={rows}
            getKey={(c) => c.id}
            searchPlaceholder="Cari customer…"
            pageSize={25}
            onRowClick={openDetail}
            toolbar={
              <Button size="sm" variant={dormantOnly ? "default" : "outline"} onClick={() => setDormantOnly((v) => !v)}>
                <MoonStar className="size-3.5" /> Dormant &gt;{data.dormant_days}h ({data.summary.dormant})
              </Button>
            }
          />
        </CardContent>
      </Card>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Customer</div>
                <DialogTitle className="break-words">{sel.name}</DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {sel.dormant ? <Badge variant="destructive">Dormant {sel.days_since}h</Badge> : <Badge variant="secondary">Aktif</Badge>}
                  <span className="text-muted-foreground">Total {rp(sel.total)} · {sel.invoices} faktur · terakhir {tgl(sel.last_date)}</span>
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
