"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import { TrendingUp, TrendingDown, ArrowRight, Loader2, AlertTriangle, PackageX, Users2, ShoppingCart, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface Rank {
  key: string;
  label: string;
  total: number;
  count: number;
}
export interface OverviewData {
  range: { from: string; to: string };
  prev_range: { from: string; to: string };
  kpi: {
    revenue: number;
    revenue_delta: number | null;
    orders: number;
    orders_delta: number | null;
    customers: number;
    customers_delta: number | null;
    ar_outstanding: number;
    ar_invoices: number;
  };
  trend: { date: string; revenue: number; orders: number }[];
  per_cabang: Rank[];
  per_product: Rank[];
  per_customer: Rank[];
  per_salesman: Rank[];
  recent_orders: { id: string; number: string | null; trans_date: string | null; customer_name: string | null; status: string | null; total_amount: number }[];
  low_stock: { id: string; no: string | null; name: string | null; quantity: number | null; available: number | null }[];
  ar_aging: { total_outstanding: number; total_invoices: number; buckets: { bucket: string; count: number; total: number }[] };
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const rpC = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};
const PIE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground text-xs">—</span>;
  const up = v >= 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-medium", up ? "text-success" : "text-danger")}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {up ? "+" : ""}{v}%
    </span>
  );
}

function Kpi({ icon: Icon, chip, label, value, delta, sub }: { icon: typeof Wallet; chip: string; label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2.5">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", chip)}>
            <Icon className="size-4" />
          </div>
          <span className="text-muted-foreground text-xs leading-tight font-medium">{label}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta !== undefined && <Delta v={delta} />}
        </div>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function BarList({ rows, money }: { rows: Rank[]; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Tidak ada data.</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={r.key + i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate" title={r.label}>{r.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{money ? rpC(r.total) : r.total}</span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: `${(r.total / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const trendConfig = { revenue: { label: "Revenue", color: "var(--chart-1)" } } satisfies ChartConfig;

const statusTone = (s: string | null): "default" | "secondary" | "destructive" | "outline" => {
  const t = (s ?? "").toLowerCase();
  if (t.includes("batal") || t.includes("tutup")) return "destructive";
  if (t.includes("proses")) return "default";
  if (t.includes("kirim") || t.includes("selesai")) return "secondary";
  return "outline";
};

export function OverviewDashboard({ initial }: { initial: OverviewData | null }) {
  const [data, setData] = useState<OverviewData | null>(initial);
  const [from, setFrom] = useState(initial?.range.from ?? "");
  const [to, setTo] = useState(initial?.range.to ?? "");
  const [loading, setLoading] = useState(false);

  async function apply() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/overview?${qs}`, { cache: "no-store" });
      const d = (await res.json()) as OverviewData;
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-16 text-center text-sm">
          Data tidak tersedia. Pastikan apps/api jalan & sinkron Accurate aktif.
        </CardContent>
      </Card>
    );
  }

  const k = data.kpi;
  const pie = data.per_product.slice(0, 5).map((r, i) => ({ name: r.label, value: r.total, fill: PIE[i % PIE.length] }));

  return (
    <div className="space-y-4">
      {/* Header + date range */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Overview</h1>
          <p className="text-muted-foreground text-sm">Ringkasan penjualan, operasional & piutang dari Accurate · {dmy(data.range.from)} → {dmy(data.range.to)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="ov-from" className="text-muted-foreground text-xs">Dari</Label>
          <Input id="ov-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-card h-8 w-auto" />
          <Label htmlFor="ov-to" className="text-muted-foreground text-xs">Sampai</Label>
          <Input id="ov-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-card h-8 w-auto" />
          <Button size="sm" onClick={apply} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null} Terapkan
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Wallet} chip="bg-success-soft text-success" label="Total Penjualan" value={rpC(k.revenue)} delta={k.revenue_delta} sub="vs periode sebelumnya" />
        <Kpi icon={ShoppingCart} chip="bg-primary-soft text-primary" label="Jumlah Invoice" value={String(k.orders)} delta={k.orders_delta} sub="vs periode sebelumnya" />
        <Kpi icon={Users2} chip="bg-info-soft text-info" label="Customer Aktif" value={String(k.customers)} delta={k.customers_delta} sub="vs periode sebelumnya" />
        <Kpi icon={AlertTriangle} chip="bg-warning-soft text-warning" label="Piutang (AR)" value={rpC(k.ar_outstanding)} sub={`${k.ar_invoices} invoice OPEN`} />
      </div>

      {/* Trend + donut */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tren Penjualan Harian</CardTitle>
          </CardHeader>
          <CardContent>
            {data.trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada data tren.</p>
            ) : (
              <ChartContainer config={trendConfig} className="h-64 w-full">
                <AreaChart data={data.trend} margin={{ left: 12, right: 12 }}>
                  <defs>
                    <linearGradient id="ovRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={dmy} tickLine={false} axisLine={false} minTickGap={24} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => rp(Number(v))} />} />
                  <Area dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={2} fill="url(#ovRev)" dot={false} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Komposisi Top Produk</CardTitle>
          </CardHeader>
          <CardContent>
            {pie.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada data.</p>
            ) : (
              <>
                <ChartContainer config={{}} className="mx-auto h-44 w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" formatter={(v) => rp(Number(v))} />} />
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {pie.map((p, i) => <Cell key={i} fill={p.fill} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 space-y-1.5">
                  {pie.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.fill }} />
                      <span className="min-w-0 truncate" title={p.name}>{p.name}</span>
                      <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">{rpC(p.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top lists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top Produk</CardTitle></CardHeader>
          <CardContent><BarList rows={data.per_product} money /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top Customer</CardTitle></CardHeader>
          <CardContent><BarList rows={data.per_customer} money /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top Sales (AM)</CardTitle></CardHeader>
          <CardContent><BarList rows={data.per_salesman} money /></CardContent>
        </Card>
      </div>

      {/* Recent orders + low stock */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Order Terbaru</CardTitle></CardHeader>
          <CardContent>
            {data.recent_orders.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada order.</p>
            ) : (
              <div className="divide-border divide-y">
                {data.recent_orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{o.number ?? "—"}</div>
                      <div className="text-muted-foreground truncate text-xs">{[dmy(o.trans_date ?? ""), o.customer_name].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {o.status && <Badge variant={statusTone(o.status)} className="hidden sm:inline-flex">{o.status}</Badge>}
                      <span className="text-sm font-medium tabular-nums whitespace-nowrap">{rp(o.total_amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <PackageX className="text-danger size-4" /> Stok Menipis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.low_stock.length === 0 ? (
              <p className="text-muted-foreground text-sm">Semua stok aman. 🎉</p>
            ) : (
              <div className="divide-border divide-y">
                {data.low_stock.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{it.name ?? "—"}</div>
                      {it.no && <div className="text-muted-foreground font-mono text-xs">{it.no}</div>}
                    </div>
                    <Badge variant={(it.quantity ?? 0) <= 0 ? "destructive" : "outline"} className="shrink-0 tabular-nums">
                      {it.quantity ?? "—"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AR aging */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
            <span>AR Aging — Piutang</span>
            <span className="text-muted-foreground text-xs font-normal">Total {rp(data.ar_aging.total_outstanding)} · {data.ar_aging.total_invoices} invoice</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.ar_aging.buckets.length === 0 ? (
            <p className="text-muted-foreground text-sm">Tidak ada data aging.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.ar_aging.buckets.map((b) => (
                <div key={b.bucket} className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{b.bucket}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{rpC(b.total)}</div>
                  <div className="text-muted-foreground flex items-center gap-1 text-xs"><ArrowRight className="size-3" /> {b.count} invoice</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
