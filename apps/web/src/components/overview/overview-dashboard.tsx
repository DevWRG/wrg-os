"use client";

import { useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import { TrendingUp, TrendingDown, Loader2, Package, ShoppingCart, Wallet, Boxes, Crown, Users2, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface Rank {
  key: string;
  label: string;
  sub?: string;
  total: number;
  count: number;
}
interface Product extends Rank {
  category: string | null;
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
  inventory: { total: number; out: number; low: number; in_stock: number };
  orders_stat: { total: number; active: number; fulfilled: number; fulfillment_pct: number };
  trend: { date: string; revenue: number; orders: number }[];
  per_cabang: Rank[];
  per_product: Product[];
  per_customer: Rank[];
  per_salesman: Rank[];
  recent_orders: { id: string; number: string | null; trans_date: string | null; customer_name: string | null; status: string | null; total_amount: number }[];
  low_stock: { id: string; no: string | null; name: string | null; quantity: number | null; available: number | null }[];
  ar_aging: { total_outstanding: number; total_invoices: number; buckets: { bucket: string; count: number; total: number }[] };
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const rpC = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const numC = (n: number) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};
const PIE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Delta({ v }: { v: number | null }) {
  if (v == null) return null;
  const up = v >= 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-medium", up ? "text-success" : "text-danger")}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {up ? "+" : ""}{v}%
    </span>
  );
}

// Link "Lihat Detail" konsisten antar-card → halaman detail terkait.
function DetailLink({ href, className }: { href: string; className?: string }) {
  return (
    <Button
      render={<Link href={href} />}
      variant="link"
      size="sm"
      className={cn("text-primary hover:text-primary-dark h-auto gap-1 rounded-md bg-primary-soft px-2 py-1 text-xs font-medium hover:bg-primary-soft/70 hover:no-underline", className)}
    >
      Lihat Detail <ArrowRight className="size-3" />
    </Button>
  );
}

function Stat({ icon: Icon, chip, label, value, delta, sub, href }: { icon: typeof Wallet; chip: string; label: string; value: string; delta?: number | null; sub?: string; href?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2.5">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", chip)}>
            <Icon className="size-4" />
          </div>
          <span className="text-muted-foreground min-w-0 text-xs leading-tight font-medium">{label}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta !== undefined && <Delta v={delta} />}
        </div>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
        {href && <div className="mt-2"><DetailLink href={href} /></div>}
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
            <span className="min-w-0 truncate" title={r.label}>
              {r.label}
              {r.sub && <span className="text-muted-foreground"> · {r.sub}</span>}
            </span>
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

// Donut dgn teks tengah (Inventory Availability & Order Fulfillment) — full ring,
// anti-clip (radius muat di tinggi container).
function CenterDonut({ slices, center, sub }: { slices: { name: string; value: number; fill: string }[]; center: string; sub?: string }) {
  const total = slices.reduce((a, b) => a + b.value, 0);
  return (
    <div className="relative">
      <ChartContainer config={{}} className="mx-auto h-40 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
          <Pie
            data={total > 0 ? slices : [{ name: "—", value: 1, fill: "var(--muted)" }]}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={72}
            startAngle={90}
            endAngle={-270}
            paddingAngle={2}
            cornerRadius={4}
          >
            {(total > 0 ? slices : [{ fill: "var(--muted)" }]).map((s, i) => <Cell key={i} fill={s.fill} stroke="none" />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center">
        <span className="text-2xl font-semibold tabular-nums">{center}</span>
        {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
      </div>
    </div>
  );
}

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
  const inv = data.inventory;
  const invHealth = inv.total > 0 ? Math.round((inv.in_stock / inv.total) * 100) : 0;
  const top = data.per_product[0];
  const customersTotal = data.per_customer.reduce((a, b) => a + b.total, 0);

  return (
    <div className="space-y-4">
      {/* Header + date range */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales Overview</h1>
          <p className="text-muted-foreground text-sm">Ringkasan bisnis dari Accurate · {dmy(data.range.from)} → {dmy(data.range.to)}</p>
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

      {/* Hero + stats + gauges */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Hero: produk terlaris */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-teal-500 via-[#0ca6bd] to-emerald-600 text-white shadow-lg lg:col-span-5 before:pointer-events-none before:absolute before:-top-16 before:-right-16 before:size-48 before:rounded-full before:bg-white/10 before:blur-2xl after:pointer-events-none after:absolute after:-bottom-20 after:-left-12 after:size-52 after:rounded-full after:bg-emerald-300/20 after:blur-3xl">
          <CardContent className="flex h-full flex-col gap-4 pt-5">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase opacity-90">
              <Crown className="size-4" /> Produk Terlaris
            </div>
            {top ? (
              <div className="relative z-10 flex h-full flex-col gap-4">
                <div>
                  <div className="text-lg leading-snug font-semibold">{top.label}</div>
                  {top.category && <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-xs">{top.category}</span>}
                </div>
                <div className="mt-auto flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-bold tabular-nums">{rpC(top.total)}</div>
                    <div className="text-xs opacity-80">{numC(top.count)} unit terjual</div>
                  </div>
                </div>
                <div className="space-y-1 border-t border-white/20 pt-3">
                  {data.per_product.slice(1, 4).map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs opacity-90">
                      <span className="min-w-0 truncate">{i + 2}. {p.label}</span>
                      <span className="shrink-0 tabular-nums">{rpC(p.total)}</span>
                    </div>
                  ))}
                </div>
                <Link href="/products" className="inline-flex items-center gap-1 text-xs font-medium text-white/90 transition-colors hover:text-white">
                  Lihat Detail <ArrowRight className="size-3" />
                </Link>
              </div>
            ) : (
              <p className="relative z-10 text-sm opacity-80">Tidak ada data produk.</p>
            )}
          </CardContent>
        </Card>

        {/* Stats + gauges */}
        <div className="space-y-4 lg:col-span-7">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon={Package} chip="bg-primary-soft text-primary" label="Total Produk" value={numC(inv.total)} sub={`${inv.in_stock} stok aman`} href="/products" />
            <Stat icon={ShoppingCart} chip="bg-info-soft text-info" label="Order Aktif" value={String(data.orders_stat.active)} sub={`dari ${data.orders_stat.total} order`} href="/orders" />
            <Stat icon={Wallet} chip="bg-success-soft text-success" label="Total Penjualan" value={rpC(k.revenue)} delta={k.revenue_delta} href="/sales-analytics" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-0"><CardTitle className="text-sm font-medium">Ketersediaan Stok</CardTitle><CardAction><DetailLink href="/inventory" /></CardAction></CardHeader>
              <CardContent>
                <CenterDonut
                  slices={[
                    { name: "Stok Aman", value: inv.in_stock, fill: "var(--chart-2)" },
                    { name: "Menipis", value: inv.low, fill: "var(--chart-4)" },
                    { name: "Habis", value: inv.out, fill: "var(--chart-3)" },
                  ]}
                  center={`${invHealth}%`}
                  sub="stok sehat"
                />
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <div><div className="text-muted-foreground">Aman</div><div className="font-medium tabular-nums">{inv.in_stock}</div></div>
                  <div><div className="text-muted-foreground">Menipis</div><div className="font-medium tabular-nums">{inv.low}</div></div>
                  <div><div className="text-muted-foreground">Habis</div><div className="font-medium tabular-nums">{inv.out}</div></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0"><CardTitle className="text-sm font-medium">Order Fulfillment</CardTitle><CardAction><DetailLink href="/orders" /></CardAction></CardHeader>
              <CardContent>
                <CenterDonut
                  slices={[
                    { name: "Terproses", value: data.orders_stat.fulfilled, fill: "var(--chart-1)" },
                    { name: "Pending", value: Math.max(0, data.orders_stat.total - data.orders_stat.fulfilled), fill: "var(--muted)" },
                  ]}
                  center={`${data.orders_stat.fulfillment_pct}%`}
                />
                <p className="text-muted-foreground mt-1 text-center text-xs">{data.orders_stat.fulfilled} dari {data.orders_stat.total} order terproses</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Best selling + top customers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Produk Terlaris (Best Selling)</CardTitle><CardAction><DetailLink href="/sales-analytics?view=per-produk" /></CardAction></CardHeader>
          <CardContent>
            {data.per_product.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada data.</p>
            ) : (
              <div className="divide-border divide-y">
                {data.per_product.map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="bg-primary-soft text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"><Boxes className="size-4" /></div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.label}</div>
                        <div className="text-muted-foreground text-xs">{[p.category, `${numC(p.count)} unit`].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums whitespace-nowrap">{rpC(p.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-rose-500/15 via-fuchsia-400/10 to-amber-300/15">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top Customers</CardTitle><CardAction><DetailLink href="/sales-analytics?view=per-customer" /></CardAction></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-2xl font-bold tabular-nums">{rpC(customersTotal)}</div>
              <p className="text-muted-foreground text-xs">total dari {data.per_customer.length} customer teratas</p>
            </div>
            <div className="space-y-2">
              {data.per_customer.slice(0, 5).map((c, i) => (
                <div key={c.key} className="flex items-center gap-2 text-sm">
                  <span className="bg-primary/15 text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums">{i + 1}</span>
                  <span className="min-w-0 truncate" title={c.label}>{c.label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">{rpC(c.total)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend + top sales */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tren Penjualan Harian</CardTitle><CardAction><DetailLink href="/sales-analytics?view=trending" /></CardAction></CardHeader>
          <CardContent>
            {data.trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada data tren.</p>
            ) : (
              <ChartContainer config={trendConfig} className="h-56 w-full">
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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top Sales (AM)</CardTitle><CardAction><DetailLink href="/sales-analytics?view=per-am" /></CardAction></CardHeader>
          <CardContent><BarList rows={data.per_salesman} money /></CardContent>
        </Card>
      </div>

      {/* AR aging */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="flex items-center gap-2"><Users2 className="text-warning size-4" /> AR Aging — Piutang</span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs font-normal">Total {rp(data.ar_aging.total_outstanding)} · {data.ar_aging.total_invoices} invoice</span>
              <DetailLink href="/ar" />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.ar_aging.buckets.length === 0 ? (
            <p className="text-muted-foreground text-sm">Tidak ada data aging.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.ar_aging.buckets.map((b, i) => (
                <div key={b.bucket} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                    <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{b.bucket}</div>
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{rpC(b.total)}</div>
                  <div className="text-muted-foreground text-xs">{b.count} invoice</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
