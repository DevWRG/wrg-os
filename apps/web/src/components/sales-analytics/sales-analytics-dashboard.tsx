"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import writeXlsxFile from "write-excel-file/browser";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SalesPerformanceCards, type SalesPerformance } from "@/components/sales/sales-performance-cards";
import { TargetPacingView, type PacingData } from "@/components/sales/target-pacing-view";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Tombol sekunder toolbar: tint teal lembut (bukan putih) — kontras di atas bg terang.
const SEC_BTN = "bg-primary-soft text-primary-dark border-primary/20 hover:bg-primary/15";

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

// Export PDF: buka tab HTML print-friendly (pola apps/api/src/repo/exportdoc.ts),
// user pilih "Save as PDF" dari dialog print. Tanpa lib PDF.
function escHtml(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function openPrintable(title: string, subtitle: string, headers: string[], rows: (string | number | null)[][]) {
  const thead = headers.map((h, i) => `<th class="${i > 0 ? "num" : ""}">${escHtml(h)}</th>`).join("");
  const tbody = rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 && typeof c === "number" ? "num" : ""}">${typeof c === "number" ? c.toLocaleString("id-ID") : escHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  @page { margin: 14mm; size: A4 landscape; }
  body { font: 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; color:#111; margin:20px; }
  h1 { font-size:16px; margin:0 0 2px; } .meta { color:#666; font-size:11px; margin-bottom:12px; }
  table { border-collapse:collapse; width:100%; } th,td { border:1px solid #ddd; padding:5px 8px; text-align:left; }
  th { background:#f3f4f6; } td.num,th.num { text-align:right; white-space:nowrap; }
  tbody tr:nth-child(even){ background:#fafafa; }
  .print { margin-top:14px; } button { font:inherit; padding:8px 14px; border:1px solid #888; border-radius:6px; background:#fff; cursor:pointer; }
  @media print { .print { display:none } body{margin:0} }
</style></head><body>
<h1>${escHtml(title)}</h1><div class="meta">${escHtml(subtitle)}</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
<div class="print"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { window.alert("Popup diblokir — izinkan popup untuk export PDF."); return; }
  w.document.write(html);
  w.document.close();
}

// ── Tipe ───────────────────────────────────────────────────────────
interface Range { from: string; to: string }
interface TrendPt { date: string; revenue: number; orders: number; anomaly?: boolean }
interface Rank { key: string; label: string; sub?: string; total: number; count: number; target?: number }
interface OverviewAll {
  scope: "all";
  kpi: { revenue: number; revenue_delta: number | null; orders: number; orders_delta: number | null; customers: number; customers_delta: number | null; ar_outstanding: number };
  trend: TrendPt[];
  per_cabang: Rank[];
  per_product: { key: string; label: string; category: string | null; total: number; count: number }[];
  per_salesman: Rank[];
  performance: SalesPerformance;
}
interface OverviewAm {
  scope: "am";
  range: Range;
  kpi: { revenue: number; orders: number; customers: number; target: number | null; achievement_pct: number | null };
  trend: TrendPt[];
}
export type OverviewResult = OverviewAll | OverviewAm;

interface AmRow { am_id: string | null; nama: string | null; cabang: string | null; region: string; total: number; count: number; target: number | null; achievement_pct: number | null; rank: number; self?: boolean }
interface ProdRow { key: string; label: string; category: string | null; satuan: string | null; stock_on_hand: number | null; total: number; unit_sold: number; customer_count: number }
interface PengadaanRow { key: string; label: string; total: number; count: number }
interface CabangRow { cabang: string; region: string; total: number; count: number; customers: number; am_count: number; target: number | null; achievement_pct: number | null }
interface CustRow { id: string; name: string; total: number; invoices: number; last_date: string | null; days_since: number | null; priority?: string }

type ViewKey = "overview" | "per-am" | "per-produk" | "per-pengadaan" | "per-cabang" | "per-customer" | "trending" | "pacing";
const TABS: { key: ViewKey; label: string }[] = [
  { key: "overview", label: "Executive" },
  { key: "per-am", label: "Per-AM" },
  { key: "per-produk", label: "Per-Produk" },
  { key: "per-pengadaan", label: "Per-Pengadaan" },
  { key: "per-cabang", label: "Per-Cabang" },
  { key: "per-customer", label: "Per-Customer" },
  { key: "trending", label: "Trending" },
  { key: "pacing", label: "Pacing" },
];
// tab (ViewKey) → view_type enum DB (migrasi 049). per-pengadaan/pacing reuse enum
// yang ada (belum ada enum tersendiri; cukup utk saved-view routing).
const VIEW_TYPE: Record<ViewKey, string> = {
  overview: "executive", "per-am": "per_am", "per-produk": "per_produk",
  "per-pengadaan": "per_produk", pacing: "per_am",
  "per-cabang": "per_cabang", "per-customer": "per_customer", trending: "trending",
};

interface SavedView { id: string; view_name: string; view_type: string; filter_config: { from?: string; to?: string; tab?: ViewKey }; }

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

// ── Main ───────────────────────────────────────────────────────────
export function SalesAnalyticsDashboard({ initial, initialView }: { initial: OverviewResult | null; initialView?: string }) {
  const startTab = (TABS.find((t) => t.key === initialView)?.key ?? "overview") as ViewKey;
  const [tab, setTab] = useState<ViewKey>(startTab);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cache, setCache] = useState<Record<string, unknown>>(initial ? { overview: initial } : {});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [views, setViews] = useState<SavedView[]>([]);
  const router = useRouter();

  const loadViews = useCallback(async () => {
    try { const r = await fetch("/api/sales-analytics/views"); if (r.ok) setViews(((await r.json()).views ?? []) as SavedView[]); } catch { /* abaikan */ }
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
      return { name: `sales-analytics_per-produk_${s}`, headers: ["Produk", "Kategori", "Unit", "Satuan", "Customer", "Stok", "Revenue"],
        rows: d.rows.map((r) => [r.label, r.category, r.unit_sold, r.satuan, r.customer_count, r.stock_on_hand, r.total]) };
    }
    if (tab === "per-pengadaan") {
      const d = cur as { rows: PengadaanRow[] };
      return { name: `sales-analytics_per-pengadaan_${s}`, headers: ["Kategori Pengadaan", "Faktur", "Revenue"],
        rows: d.rows.map((r) => [r.label, r.count, r.total]) };
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
    if (tab === "pacing") {
      const d = cur as PacingData;
      return { name: `sales-analytics_pacing_${d.year}`, headers: ["AM", "Cabang", "Target", "Actual", "Achievement%", "Pace%", "Status", "Proyeksi%"],
        rows: d.am.map((r) => [r.nama, r.cabang, r.target, r.actual, r.achievement_pct, r.pace, r.status, r.projected_pct]) };
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

  const exportPdf = () => {
    const v = viewData();
    if (!v) return;
    const label = TABS.find((t) => t.key === tab)?.label ?? tab;
    openPrintable(`Sales Analytics — ${label}`, `Periode: ${from || "YTD"} → ${to || "now"} · ${v.rows.length} baris`, v.headers, v.rows);
  };

  // Drilldown AM dibuka di HALAMAN terpisah (bukan section di bawah tabel) —
  // bawa rentang tanggal aktif sebagai query supaya konsisten.
  const openDrill = (amId: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const s = qs.toString();
    router.push(`/sales-analytics/am/${amId}${s ? `?${s}` : ""}`);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadViews() men-setState setelah fetch; disengaja.
    void loadViews();
  }, [loadViews]);

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

  return (
    <div className="space-y-4">
      {/* Filter periode + aksi */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1"><Label htmlFor="sa-from" className="text-xs">Dari</Label><Input id="sa-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 bg-card border-border" /></div>
          <div className="grid gap-1"><Label htmlFor="sa-to" className="text-xs">Sampai</Label><Input id="sa-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 bg-card border-border" /></div>
          <Button size="sm" onClick={apply}>Terapkan</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" className={SEC_BTN} disabled={!cur} />}>Export data ▾</DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={exportCsv}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportXlsx()}>Export XLSX</DropdownMenuItem>
              <DropdownMenuItem onClick={exportPdf}>Export PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className={SEC_BTN} onClick={saveCurrentView}>Simpan view</Button>
          <span className="text-muted-foreground text-xs">Kosongkan = year-to-date.</span>
        </CardContent>
      </Card>

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

      {tab === "overview" && cur != null && <OverviewView data={cur as OverviewResult} onNav={setTab} />}
      {tab === "per-am" && cur != null && <PerAmView data={cur as { rows: AmRow[]; scope: string }} onDrill={openDrill} />}
      {tab === "per-produk" && cur != null && <PerProdukView data={cur as { rows: ProdRow[] }} />}
      {tab === "per-pengadaan" && cur != null && <PerPengadaanView data={cur as { rows: PengadaanRow[] }} />}
      {tab === "per-cabang" && cur != null && <PerCabangView data={cur as { rows: CabangRow[] }} />}
      {tab === "per-customer" && cur != null && <PerCustomerView data={cur as { scope: string; customers: CustRow[]; summary?: Record<string, number> }} />}
      {tab === "trending" && cur != null && <TrendingView data={cur as { points: TrendPt[]; mean: number; std: number }} />}
      {tab === "pacing" && cur != null && <TargetPacingView data={cur as PacingData} />}
    </div>
  );
}

// ── Views ──────────────────────────────────────────────────────────
function DetailLink({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="link"
      size="sm"
      className="text-primary hover:text-primary-dark h-auto gap-1 rounded-md bg-primary-soft px-2 py-1 text-xs font-medium hover:bg-primary-soft/70 hover:no-underline"
    >
      Lihat Detail <ArrowRight className="size-3" />
    </Button>
  );
}

function OverviewView({ data, onNav }: { data: OverviewResult; onNav: (t: ViewKey) => void }) {
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
      <SalesPerformanceCards data={data.performance} />
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Tren Revenue Harian</CardTitle><DetailLink onClick={() => onNav("trending")} /></CardHeader><CardContent><TrendChart points={data.trend} /></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Per Cabang</CardTitle><DetailLink onClick={() => onNav("per-cabang")} /></CardHeader>
          <CardContent><DataTable data={data.per_cabang} getKey={(r) => r.key} searchPlaceholder="Cari cabang…" initialSort={{ id: "total", dir: "desc" }}
            columns={[
              { id: "label", header: "Cabang", sortable: true, accessor: (r) => r.label },
              { id: "count", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.count },
              { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
            ]} /></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Top Produk</CardTitle><DetailLink onClick={() => onNav("per-produk")} /></CardHeader>
          <CardContent><DataTable data={data.per_product} getKey={(r) => r.key} searchPlaceholder="Cari produk…" initialSort={{ id: "total", dir: "desc" }}
            columns={[
              { id: "label", header: "Produk", sortable: true, accessor: (r) => r.label },
              { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
            ]} /></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Top Sales</CardTitle><DetailLink onClick={() => onNav("per-am")} /></CardHeader>
          <CardContent><DataTable data={data.per_salesman} getKey={(r) => r.key} searchPlaceholder="Cari sales…" initialSort={{ id: "total", dir: "desc" }}
            columns={[
              { id: "label", header: "Sales", sortable: true, accessor: (r) => r.label },
              { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
            ]} /></CardContent></Card>
      </div>
    </div>
  );
}

const amColumns = (onDrill: (amId: string) => void): DataColumn<AmRow>[] => [
  { id: "rank", header: "#", sortable: true, accessor: (r) => r.rank },
  { id: "nama", header: "AM", sortable: true, accessor: (r) => r.nama, cell: (r) => <span className={r.self ? "font-semibold text-primary" : ""}>{r.nama ?? "—"}{r.self ? " (Anda)" : ""}</span> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang },
  { id: "region", header: "Region", sortable: true, accessor: (r) => r.region },
  { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
  { id: "target", header: "Target", align: "right", sortable: true, accessor: (r) => r.target, cell: (r) => (r.target != null ? fmtRp(r.target) : "—") },
  { id: "ach", header: "%", align: "right", sortable: true, accessor: (r) => r.achievement_pct, cell: (r) => fmtPct(r.achievement_pct) },
  { id: "aksi", header: "", align: "right", cell: (r) => (r.am_id ? <Button size="sm" variant="outline" className="border-primary text-primary hover:bg-primary/10" onClick={() => onDrill(r.am_id!)}>Detail</Button> : null) },
];

function PerAmView({ data, onDrill }: { data: { rows: AmRow[]; scope: string }; onDrill: (amId: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Performa per-AM {data.scope === "am" && <span className="text-muted-foreground text-xs font-normal">(peer dianonimkan)</span>}</CardTitle></CardHeader>
      <CardContent>
        <DataTable data={data.rows} columns={amColumns(onDrill)} getKey={(r) => String(r.rank)} searchPlaceholder="Cari AM/cabang…" initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada data AM." />
      </CardContent>
    </Card>
  );
}

const prodColumns: DataColumn<ProdRow>[] = [
  { id: "label", header: "Produk", sortable: true, accessor: (r) => r.label },
  { id: "category", header: "Kategori", sortable: true, accessor: (r) => r.category },
  { id: "unit_sold", header: "Unit", align: "right", sortable: true, accessor: (r) => r.unit_sold },
  { id: "satuan", header: "Satuan", sortable: true, accessor: (r) => r.satuan, cell: (r) => r.satuan ?? "—" },
  { id: "customer_count", header: "Customer", align: "right", sortable: true, accessor: (r) => r.customer_count },
  { id: "stock_on_hand", header: "Stok", align: "right", sortable: true, accessor: (r) => r.stock_on_hand, cell: (r) => (r.stock_on_hand ?? "—") },
  { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
];

function PerProdukView({ data }: { data: { rows: ProdRow[] } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Portfolio Produk</CardTitle></CardHeader>
      <CardContent><DataTable data={data.rows} columns={prodColumns} getKey={(r) => r.key} searchPlaceholder="Cari produk/kategori…" initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada data produk." /></CardContent></Card>
  );
}

const pengadaanColumns: DataColumn<PengadaanRow>[] = [
  { id: "label", header: "Kategori Pengadaan", sortable: true, accessor: (r) => r.label },
  { id: "count", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.count },
  { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
];

function PerPengadaanView({ data }: { data: { rows: PengadaanRow[] } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Per Pengadaan (kategori penjualan)</CardTitle></CardHeader>
      <CardContent><DataTable data={data.rows} columns={pengadaanColumns} getKey={(r) => r.key} searchPlaceholder="Cari kategori…" initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada data pengadaan." /></CardContent></Card>
  );
}

const cabangColumns: DataColumn<CabangRow>[] = [
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang },
  { id: "region", header: "Region", sortable: true, accessor: (r) => r.region },
  { id: "am_count", header: "AM", align: "right", sortable: true, accessor: (r) => r.am_count },
  { id: "customers", header: "Customer", align: "right", sortable: true, accessor: (r) => r.customers },
  { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
  { id: "target", header: "Target", align: "right", sortable: true, accessor: (r) => r.target, cell: (r) => (r.target != null ? fmtRpShort(r.target) : "—") },
  { id: "ach", header: "%", align: "right", sortable: true, accessor: (r) => r.achievement_pct, cell: (r) => fmtPct(r.achievement_pct) },
];

function PerCabangView({ data }: { data: { rows: CabangRow[] } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Territory per-Cabang</CardTitle></CardHeader>
      <CardContent><DataTable data={data.rows} columns={cabangColumns} getKey={(r) => r.cabang} searchPlaceholder="Cari cabang…" initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada data cabang." /></CardContent></Card>
  );
}

const custColumns: DataColumn<CustRow>[] = [
  { id: "name", header: "Customer", sortable: true, accessor: (r) => r.name },
  { id: "invoices", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.invoices },
  { id: "last_date", header: "Terakhir", sortable: true, accessor: (r) => r.last_date, cell: (r) => (r.last_date ?? "—") },
  { id: "days_since", header: "Hari", align: "right", sortable: true, accessor: (r) => r.days_since, cell: (r) => (r.days_since ?? "—") },
  { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
];

function PerCustomerView({ data }: { data: { scope: string; customers: CustRow[]; summary?: Record<string, number> } }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Customer {data.scope === "am" && <span className="text-muted-foreground text-xs font-normal">(customer Anda)</span>}</CardTitle></CardHeader>
      <CardContent><DataTable data={data.customers} columns={custColumns} getKey={(r) => r.id} searchPlaceholder="Cari customer…" initialSort={{ id: "total", dir: "desc" }} pageSize={25} empty="Tidak ada data customer." /></CardContent></Card>
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
