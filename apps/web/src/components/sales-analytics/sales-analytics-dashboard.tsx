"use client";

import { useCallback, useEffect, useState } from "react";
import writeXlsxFile from "write-excel-file/browser";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Format ─────────────────────────────────────────────────────────
const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number) => rp.format(n || 0);
const fmtRpShort = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)}M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)}jt`;
  return fmtRp(v);
};
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

// Export CSV (UTF-8 BOM → Excel buka langsung). Angka mentah (bukan terformat).
function downloadCsv(name: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ── Tipe ───────────────────────────────────────────────────────────
interface Range { from: string; to: string }
interface TrendPt { date: string; revenue: number; orders: number; anomaly?: boolean }
interface Rank { key: string; label: string; sub?: string; total: number; count: number; target?: number }
interface RegionCell { region: string; total: number }
interface PeriodCard {
  key: string; label: string; total: number; regions: RegionCell[];
  target: { east: number | null; west: number | null; total: number | null };
  pct: { total: number | null; east: number | null; west: number | null };
}
interface OverviewAll {
  scope: "all";
  kpi: { revenue: number; revenue_delta: number | null; orders: number; orders_delta: number | null; customers: number; customers_delta: number | null; ar_outstanding: number };
  trend: TrendPt[];
  per_cabang: Rank[];
  per_product: { key: string; label: string; category: string | null; total: number; count: number }[];
  per_salesman: Rank[];
  performance: { periods: PeriodCard[] };
}
interface OverviewAm {
  scope: "am";
  range: Range;
  kpi: { revenue: number; orders: number; customers: number; target: number | null; achievement_pct: number | null };
  trend: TrendPt[];
}
export type OverviewResult = OverviewAll | OverviewAm;

interface AmRow { am_id: string | null; nama: string | null; cabang: string | null; region: string; total: number; count: number; target: number | null; achievement_pct: number | null; rank: number; self?: boolean }
interface ProdRow { key: string; label: string; category: string | null; stock_on_hand: number | null; total: number; unit_sold: number; customer_count: number }
interface CabangRow { cabang: string; region: string; total: number; count: number; customers: number; am_count: number; target: number | null; achievement_pct: number | null }
interface CustRow { id: string; name: string; total: number; invoices: number; last_date: string | null; days_since: number | null; priority?: string }
interface Drilldown { am_id: string; per_produk: { key: string; label: string; total: number; qty: number }[]; per_customer: { key: string; label: string; total: number; count: number }[] }

type ViewKey = "overview" | "per-am" | "per-produk" | "per-cabang" | "per-customer" | "trending";
const TABS: { key: ViewKey; label: string }[] = [
  { key: "overview", label: "Executive" },
  { key: "per-am", label: "Per-AM" },
  { key: "per-produk", label: "Per-Produk" },
  { key: "per-cabang", label: "Per-Cabang" },
  { key: "per-customer", label: "Per-Customer" },
  { key: "trending", label: "Trending" },
];
// tab (ViewKey) → view_type enum DB (migrasi 049).
const VIEW_TYPE: Record<ViewKey, string> = {
  overview: "executive", "per-am": "per_am", "per-produk": "per_produk",
  "per-cabang": "per_cabang", "per-customer": "per_customer", trending: "trending",
};

interface SavedView { id: string; view_name: string; view_type: string; filter_config: { from?: string; to?: string; tab?: ViewKey }; }
interface SalesAlert { id: string; alert_name: string; metric_key: string; threshold_operator: string; threshold_value: number; window_days: number; }

const ALERT_METRICS = ["revenue", "ar_gt_90", "customer_count", "new_customer_count", "churn_count"];
const ALERT_OPS = [["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"]];

// ── Sub-komponen ───────────────────────────────────────────────────
function Kpi({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {delta != null && (
          <div className={`text-xs font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs periode lalu
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left">
          <tr className="border-b">{head.map((h, i) => <th key={i} className={`py-2 pr-3 ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((cell, j) => <td key={j} className={`py-1.5 pr-3 ${j > 0 ? "text-right whitespace-nowrap" : "font-medium"}`}>{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={head.length} className="text-muted-foreground py-6 text-center">Tidak ada data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────
export function SalesAnalyticsDashboard({ initial }: { initial: OverviewResult | null }) {
  const [tab, setTab] = useState<ViewKey>("overview");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cache, setCache] = useState<Record<string, unknown>>(initial ? { overview: initial } : {});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [drill, setDrill] = useState<Drilldown | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [alerts, setAlerts] = useState<SalesAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);

  const loadViews = useCallback(async () => {
    try { const r = await fetch("/api/sales-analytics/views"); if (r.ok) setViews(((await r.json()).views ?? []) as SavedView[]); } catch { /* abaikan */ }
  }, []);
  const loadAlerts = useCallback(async () => {
    try { const r = await fetch("/api/sales-analytics/alerts"); if (r.ok) setAlerts(((await r.json()).alerts ?? []) as SalesAlert[]); } catch { /* abaikan */ }
  }, []);

  const load = useCallback(async (view: ViewKey, force = false) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const cacheKey = `${view}?${qs.toString()}`;
    if (!force && cache[cacheKey]) return;
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/sales-analytics/${view}?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) { setErr(String(data.error ?? `HTTP ${res.status}`)); return; }
      setCache((c) => ({ ...c, [cacheKey]: data, [view]: data }));
    } catch {
      setErr("gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, [from, to, cache]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    void load(tab);
  }, [tab, load]);

  const cur = cache[tab] as unknown;
  const apply = () => { setCache({}); load(tab, true); };

  // Data view aktif → {name, headers, rows} (angka mentah) dipakai CSV & XLSX.
  const viewData = (): { name: string; headers: string[]; rows: (string | number | null)[][] } | null => {
    if (!cur) return null;
    const s = `${from || "ytd"}_${to || "now"}`;
    if (tab === "per-am") {
      const d = cur as { rows: AmRow[] };
      return { name: `sales-analytics_per-am_${s}`, headers: ["Rank", "AM", "Cabang", "Region", "Revenue", "Target", "Achievement%", "Faktur"],
        rows: d.rows.map((r) => [r.rank, r.nama, r.cabang, r.region, r.total, r.target, r.achievement_pct, r.count]) };
    }
    if (tab === "per-produk") {
      const d = cur as { rows: ProdRow[] };
      return { name: `sales-analytics_per-produk_${s}`, headers: ["Produk", "Kategori", "Unit", "Customer", "Stok", "Revenue"],
        rows: d.rows.map((r) => [r.label, r.category, r.unit_sold, r.customer_count, r.stock_on_hand, r.total]) };
    }
    if (tab === "per-cabang") {
      const d = cur as { rows: CabangRow[] };
      return { name: `sales-analytics_per-cabang_${s}`, headers: ["Cabang", "Region", "AM", "Customer", "Revenue", "Target", "Achievement%", "Faktur"],
        rows: d.rows.map((r) => [r.cabang, r.region, r.am_count, r.customers, r.total, r.target, r.achievement_pct, r.count]) };
    }
    if (tab === "per-customer") {
      const d = cur as { customers: CustRow[] };
      return { name: `sales-analytics_per-customer_${s}`, headers: ["Customer", "Faktur", "Terakhir", "Hari", "Revenue"],
        rows: d.customers.map((r) => [r.name, r.invoices, r.last_date, r.days_since, r.total]) };
    }
    if (tab === "trending") {
      const d = cur as { points: TrendPt[] };
      return { name: `sales-analytics_trending_${s}`, headers: ["Tanggal", "Revenue", "Faktur", "Anomali"],
        rows: d.points.map((p) => [p.date, p.revenue, p.orders, p.anomaly ? "YA" : ""]) };
    }
    const d = cur as OverviewResult;
    if (d.scope === "all") {
      return { name: `sales-analytics_overview_${s}`, headers: ["Cabang", "Faktur", "Revenue"], rows: d.per_cabang.map((r) => [r.label, r.count, r.total]) };
    }
    return { name: `sales-analytics_overview_${s}`, headers: ["Tanggal", "Revenue", "Faktur"], rows: d.trend.map((p) => [p.date, p.revenue, p.orders]) };
  };

  const exportCsv = () => {
    const v = viewData();
    if (v) downloadCsv(`${v.name}.csv`, v.headers, v.rows);
  };

  const exportXlsx = async () => {
    const v = viewData();
    if (!v) return;
    const header = v.headers.map((h) => ({ value: h, fontWeight: "bold" as const }));
    const body = v.rows.map((r) => r.map((c) =>
      typeof c === "number"
        ? { type: Number, value: c, format: "#,##0" }
        : { type: String, value: c == null ? "" : String(c) }));
    await writeXlsxFile([header, ...body]).toFile(`${v.name}.xlsx`);
  };

  const openDrill = async (amId: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const res = await fetch(`/api/sales-analytics/per-am/${amId}/drilldown?${qs.toString()}`);
      const data = await res.json();
      if (res.ok) setDrill(data as Drilldown);
    } catch { /* abaikan */ }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load*() men-setState setelah fetch; disengaja.
    void loadViews(); void loadAlerts();
  }, [loadViews, loadAlerts]);

  const saveCurrentView = async () => {
    const name = window.prompt("Nama view:");
    if (!name) return;
    await fetch("/api/sales-analytics/views", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ view_name: name, view_type: VIEW_TYPE[tab], filter_config: { from, to, tab } }),
    });
    void loadViews();
  };
  const applyView = (v: SavedView) => {
    setFrom(v.filter_config.from ?? ""); setTo(v.filter_config.to ?? "");
    if (v.filter_config.tab) setTab(v.filter_config.tab);
    setCache({});
  };
  const delView = async (id: string) => { await fetch(`/api/sales-analytics/views/${id}`, { method: "DELETE" }); void loadViews(); };

  const addAlert = async (a: { alert_name: string; metric_key: string; threshold_operator: string; threshold_value: number; window_days: number }) => {
    const r = await fetch("/api/sales-analytics/alerts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(a),
    });
    if (r.ok) void loadAlerts();
    else setErr(String((await r.json().catch(() => ({}))).error ?? "gagal simpan alert"));
  };
  const delAlert = async (id: string) => { await fetch(`/api/sales-analytics/alerts/${id}`, { method: "DELETE" }); void loadAlerts(); };

  return (
    <div className="space-y-4">
      {/* Filter periode + tabs */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><Label htmlFor="sa-from" className="text-xs">Dari</Label><Input id="sa-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div className="grid gap-1"><Label htmlFor="sa-to" className="text-xs">Sampai</Label><Input id="sa-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
        <Button size="sm" variant="outline" onClick={apply}>Terapkan</Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!cur}>Export CSV</Button>
        <Button size="sm" variant="outline" onClick={() => void exportXlsx()} disabled={!cur}>Export XLSX</Button>
        <Button size="sm" variant="outline" onClick={saveCurrentView}>Simpan view</Button>
        <Button size="sm" variant={showAlerts ? "default" : "outline"} onClick={() => setShowAlerts((s) => !s)}>Alert{alerts.length ? ` (${alerts.length})` : ""}</Button>
        <span className="text-muted-foreground text-xs">Kosongkan = year-to-date.</span>
      </div>

      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Saved views:</span>
          {views.map((v) => (
            <span key={v.id} className="bg-muted flex items-center gap-1 rounded-full px-2.5 py-1 text-xs">
              <button className="font-medium hover:underline" onClick={() => applyView(v)}>{v.view_name}</button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => void delView(v.id)} aria-label="Hapus">×</button>
            </span>
          ))}
        </div>
      )}

      {showAlerts && <AlertsPanel alerts={alerts} onAdd={addAlert} onDelete={delAlert} />}

      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {loading && <div className="text-muted-foreground text-sm">Memuat…</div>}

      {tab === "overview" && cur != null && <OverviewView data={cur as OverviewResult} />}
      {tab === "per-am" && cur != null && <PerAmView data={cur as { rows: AmRow[]; scope: string }} onDrill={openDrill} />}
      {tab === "per-produk" && cur != null && <PerProdukView data={cur as { rows: ProdRow[] }} />}
      {tab === "per-cabang" && cur != null && <PerCabangView data={cur as { rows: CabangRow[] }} />}
      {tab === "per-customer" && cur != null && <PerCustomerView data={cur as { scope: string; customers: CustRow[]; summary?: Record<string, number> }} />}
      {tab === "trending" && cur != null && <TrendingView data={cur as { points: TrendPt[]; mean: number; std: number }} />}

      {drill && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Drilldown AM {drill.am_id}</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setDrill(null)}>Tutup</Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div><div className="mb-1 text-sm font-semibold">Per Produk</div><SimpleTable head={["Produk", "Qty", "Revenue"]} rows={drill.per_produk.map((p) => [p.label, p.qty, fmtRp(p.total)])} /></div>
            <div><div className="mb-1 text-sm font-semibold">Per Customer</div><SimpleTable head={["Customer", "Faktur", "Revenue"]} rows={drill.per_customer.map((p) => [p.label, p.count, fmtRp(p.total)])} /></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Alerts panel ───────────────────────────────────────────────────
function AlertsPanel({ alerts, onAdd, onDelete }: {
  alerts: SalesAlert[];
  onAdd: (a: { alert_name: string; metric_key: string; threshold_operator: string; threshold_value: number; window_days: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState(ALERT_METRICS[0]);
  const [op, setOp] = useState("lt");
  const [value, setValue] = useState("");
  const [win, setWin] = useState("7");
  const submit = async () => {
    if (!name.trim() || value === "") return;
    await onAdd({ alert_name: name.trim(), metric_key: metric, threshold_operator: op, threshold_value: Number(value), window_days: Number(win) || 7 });
    setName(""); setValue("");
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Alert threshold</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Nama alert" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-40" />
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {ALERT_METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={op} onChange={(e) => setOp(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {ALERT_OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Input type="number" placeholder="nilai" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-32" />
          <Input type="number" placeholder="hari" value={win} onChange={(e) => setWin(e.target.value)} className="h-9 w-24" />
          <Button size="sm" onClick={() => void submit()}>Tambah</Button>
        </div>
        {alerts.length === 0 ? <p className="text-muted-foreground text-sm">Belum ada alert.</p> : (
          <ul className="space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-b py-1 last:border-0">
                <span>{a.alert_name} — <code className="bg-muted rounded px-1">{a.metric_key} {a.threshold_operator} {a.threshold_value.toLocaleString("id-ID")}</code> · {a.window_days}h</span>
                <Button size="sm" variant="ghost" onClick={() => void onDelete(a.id)}>Hapus</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Views ──────────────────────────────────────────────────────────
function OverviewView({ data }: { data: OverviewResult }) {
  if (data.scope === "am") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Revenue (Anda)" value={fmtRp(data.kpi.revenue)} />
          <Kpi label="Faktur" value={String(data.kpi.orders)} />
          <Kpi label="Customer" value={String(data.kpi.customers)} />
          <Kpi label="Achievement" value={fmtPct(data.kpi.achievement_pct)} />
        </div>
        <TrendChart points={data.trend} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue" value={fmtRp(data.kpi.revenue)} delta={data.kpi.revenue_delta} />
        <Kpi label="Faktur" value={String(data.kpi.orders)} delta={data.kpi.orders_delta} />
        <Kpi label="Customer" value={String(data.kpi.customers)} delta={data.kpi.customers_delta} />
        <Kpi label="AR Outstanding" value={fmtRp(data.kpi.ar_outstanding)} />
      </div>
      <Card><CardHeader><CardTitle className="text-base">Tren Revenue Harian</CardTitle></CardHeader><CardContent><TrendChart points={data.trend} /></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Target vs Realisasi (Region)</CardTitle></CardHeader>
          <CardContent><SimpleTable head={["Periode", "Realisasi", "Target", "%"]}
            rows={data.performance.periods.map((p) => [p.label, fmtRpShort(p.total), p.target.total != null ? fmtRpShort(p.target.total) : "—", fmtPct(p.pct.total)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Per Cabang</CardTitle></CardHeader>
          <CardContent><SimpleTable head={["Cabang", "Faktur", "Revenue"]} rows={data.per_cabang.slice(0, 10).map((r) => [r.label, r.count, fmtRp(r.total)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Top Produk</CardTitle></CardHeader>
          <CardContent><SimpleTable head={["Produk", "Revenue"]} rows={data.per_product.slice(0, 10).map((r) => [r.label, fmtRp(r.total)])} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Top Sales</CardTitle></CardHeader>
          <CardContent><SimpleTable head={["Sales", "Revenue"]} rows={data.per_salesman.slice(0, 10).map((r) => [r.label, fmtRp(r.total)])} /></CardContent></Card>
      </div>
    </div>
  );
}

function PerAmView({ data, onDrill }: { data: { rows: AmRow[]; scope: string }; onDrill: (amId: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Performa per-AM {data.scope === "am" && <span className="text-muted-foreground text-xs font-normal">(peer dianonimkan)</span>}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left"><tr className="border-b">
            <th className="py-2 pr-3">#</th><th className="pr-3">AM</th><th className="pr-3">Cabang</th><th className="pr-3">Region</th>
            <th className="pr-3 text-right">Revenue</th><th className="pr-3 text-right">Target</th><th className="pr-3 text-right">%</th><th></th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.rank} className={`border-b last:border-0 ${r.self ? "bg-primary/5 font-semibold" : ""}`}>
                <td className="py-1.5 pr-3">{r.rank}</td>
                <td className="pr-3">{r.nama ?? "—"}{r.self && " (Anda)"}</td>
                <td className="pr-3">{r.cabang ?? "—"}</td>
                <td className="pr-3">{r.region}</td>
                <td className="pr-3 text-right whitespace-nowrap">{fmtRp(r.total)}</td>
                <td className="pr-3 text-right whitespace-nowrap">{r.target != null ? fmtRp(r.target) : "—"}</td>
                <td className="pr-3 text-right">{fmtPct(r.achievement_pct)}</td>
                <td className="text-right">{r.am_id && <Button size="sm" variant="ghost" onClick={() => onDrill(r.am_id!)}>Detail</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function PerProdukView({ data }: { data: { rows: ProdRow[] } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Portfolio Produk</CardTitle></CardHeader>
      <CardContent><SimpleTable head={["Produk", "Kategori", "Unit", "Customer", "Stok", "Revenue"]}
        rows={data.rows.slice(0, 100).map((r) => [r.label, r.category ?? "—", r.unit_sold, r.customer_count, r.stock_on_hand ?? "—", fmtRp(r.total)])} /></CardContent></Card>
  );
}

function PerCabangView({ data }: { data: { rows: CabangRow[] } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Territory per-Cabang</CardTitle></CardHeader>
      <CardContent><SimpleTable head={["Cabang", "Region", "AM", "Customer", "Revenue", "Target", "%"]}
        rows={data.rows.map((r) => [r.cabang, r.region, r.am_count, r.customers, fmtRp(r.total), r.target != null ? fmtRpShort(r.target) : "—", fmtPct(r.achievement_pct)])} /></CardContent></Card>
  );
}

function PerCustomerView({ data }: { data: { scope: string; customers: CustRow[]; summary?: Record<string, number> } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Customer {data.scope === "am" && <span className="text-muted-foreground text-xs font-normal">(customer Anda)</span>}</CardTitle></CardHeader>
      <CardContent><SimpleTable head={["Customer", "Faktur", "Terakhir", "Hari", "Revenue"]}
        rows={data.customers.slice(0, 100).map((r) => [r.name, r.invoices, r.last_date ?? "—", r.days_since ?? "—", fmtRp(r.total)])} /></CardContent></Card>
  );
}

function TrendingView({ data }: { data: { points: TrendPt[]; mean: number; std: number } }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Tren Revenue {data.points.some((p) => p.anomaly) && <span className="text-amber-600 text-xs font-normal">· anomali ≥2σ ditandai</span>}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.points}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis tickFormatter={(v) => fmtRpShort(Number(v))} fontSize={11} width={70} />
            <Tooltip formatter={(v) => fmtRp(Number(v))} />
            <Line type="monotone" dataKey="revenue" stroke="#2563a8" dot={(props: { cx?: number; cy?: number; payload?: TrendPt; index?: number }) =>
              props.payload?.anomaly
                ? <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="#d97706" />
                : <circle key={props.index} cx={props.cx} cy={props.cy} r={1.5} fill="#2563a8" />} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TrendChart({ points }: { points: TrendPt[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="date" fontSize={11} />
        <YAxis tickFormatter={(v) => fmtRpShort(Number(v))} fontSize={11} width={70} />
        <Tooltip formatter={(v) => fmtRp(Number(v))} />
        <Bar dataKey="revenue" fill="#2563a8">
          {points.map((p, i) => <Cell key={i} fill={p.anomaly ? "#d97706" : "#2563a8"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
