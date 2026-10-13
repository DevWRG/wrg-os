"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Target, ShoppingCart, TrendingUpDown, Tags } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { StatCard } from "@/components/dashboard/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/use-confirm";
import { BULAN, PurchaseForecastForm, type ForecastVendor, type PurchaseForecast } from "./purchase-forecast-form";

interface RingkasanBaris {
  key: string;
  forecast_value: number | null;
  actual_value: number;
  gap_value: number | null;
  gap_percent: number | null;
  po_count: number;
}

export interface PurchaseForecastSummary {
  period_year: number;
  period_month: number | null;
  total: { forecast_value: number; forecast_basis: "semua" | "jumlah_baris" | "kosong"; actual_value: number; gap_value: number; gap_percent: number | null };
  klasifikasi: { actual_value: number; terklasifikasi_value: number; persen: number | null };
  by_lini: RingkasanBaris[];
  by_vendor: RingkasanBaris[];
  by_brand: RingkasanBaris[];
}

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const rp = (v: number): string => `Rp ${Math.round(v).toLocaleString("id-ID")}`;
// Ringkas untuk kartu: 1.234.000.000 → "Rp 1,23 M"; 12.300.000 → "Rp 12,3 jt".
export function rpRingkas(v: number): string {
  const a = Math.abs(v);
  const tanda = v < 0 ? "−" : "";
  if (a >= 1e9) return `${tanda}Rp ${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${tanda}Rp ${(a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `${tanda}Rp ${Math.round(a).toLocaleString("id-ID")}`;
}

function GapBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground text-xs">—</span>;
  const label = `${pct > 0 ? "+" : ""}${pct.toLocaleString("id-ID")}%`;
  // Pembelian MELEBIHI rencana = perlu perhatian; di bawah rencana = netral.
  return <Badge variant={pct > 10 ? "destructive" : pct < -10 ? "secondary" : "outline"}>{label}</Badge>;
}

const kolomRingkasan = (judul: string, denganForecast: boolean): DataColumn<RingkasanBaris>[] => [
  {
    id: "key", header: judul, sortable: true, accessor: (r) => r.key,
    cell: (r) => <span className={r.key.startsWith("Belum") || r.key.startsWith("Vendor tanpa") ? "text-muted-foreground italic" : "font-medium"}>{r.key}</span>,
  },
  ...(denganForecast
    ? ([
        { id: "forecast", header: "Forecast", sortable: true, align: "right", accessor: (r) => r.forecast_value ?? 0, cell: (r) => <span className="tabular-nums">{r.forecast_value ? rp(r.forecast_value) : "—"}</span> },
      ] as DataColumn<RingkasanBaris>[])
    : []),
  { id: "actual", header: "Realisasi PO", sortable: true, align: "right", accessor: (r) => r.actual_value, cell: (r) => <span className="tabular-nums">{rp(r.actual_value)}</span> },
  ...(denganForecast
    ? ([
        { id: "gap", header: "Gap", sortable: true, align: "right", accessor: (r) => r.gap_percent ?? -Infinity, cell: (r) => (r.forecast_value ? <GapBadge pct={r.gap_percent} /> : <span className="text-muted-foreground text-xs">—</span>) },
      ] as DataColumn<RingkasanBaris>[])
    : []),
  { id: "po", header: "PO", sortable: true, align: "right", accessor: (r) => r.po_count },
];

export function PurchaseForecastDashboard({
  vendors,
  initialYear,
  initialMonth,
  initialSummary,
  initialRows,
}: {
  vendors: ForecastVendor[];
  initialYear: number;
  initialMonth: number;
  initialSummary: PurchaseForecastSummary | null;
  initialRows: PurchaseForecast[];
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState<number | "">(initialMonth);
  const [summary, setSummary] = useState(initialSummary);
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);
  const { confirm, dialog } = useConfirm();
  const pertama = useRef(true);

  const muat = useCallback(async () => {
    const qs = new URLSearchParams({ year: String(year), ...(month ? { month: String(month) } : {}) });
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch(`/api/purchase-forecast/summary?${qs}`, { cache: "no-store" }),
        fetch(`/api/purchase-forecast?${qs}`, { cache: "no-store" }),
      ]);
      setSummary(s.ok ? ((await s.json()) as PurchaseForecastSummary) : null);
      setRows(r.ok ? ((await r.json()) as { rows: PurchaseForecast[] }).rows : []);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    // Periode awal sudah diambil server — muat ulang hanya saat periode diganti.
    if (pertama.current) {
      pertama.current = false;
      return;
    }
    void muat();
  }, [muat]);

  function hapus(r: PurchaseForecast) {
    confirm(
      {
        title: "Hapus forecast?",
        description: `${BULAN[r.period_month - 1]} ${r.period_year} · ${r.lini ?? "semua lini"} · ${r.vendor_name ?? "semua vendor"} (${rp(r.forecast_value)})`,
        destructive: true,
        confirmLabel: "Hapus",
      },
      async () => {
        await fetch(`/api/purchase-forecast/${r.id}`, { method: "DELETE" });
        void muat();
      },
    );
  }

  const kolomForecast: DataColumn<PurchaseForecast>[] = [
    { id: "periode", header: "Periode", sortable: true, accessor: (r) => r.period_year * 100 + r.period_month, cell: (r) => `${BULAN[r.period_month - 1]} ${r.period_year}` },
    { id: "lini", header: "Lini", accessor: (r) => r.lini ?? "", cell: (r) => r.lini ?? <span className="text-muted-foreground">Semua</span> },
    { id: "vendor", header: "Vendor", sortable: true, accessor: (r) => r.vendor_name ?? "", cell: (r) => r.vendor_name ?? <span className="text-muted-foreground">Semua</span> },
    { id: "forecast", header: "Forecast", sortable: true, align: "right", accessor: (r) => r.forecast_value, cell: (r) => <span className="tabular-nums">{rp(r.forecast_value)}</span> },
    { id: "actual", header: "Realisasi", sortable: true, align: "right", accessor: (r) => r.actual_value, cell: (r) => <span className="tabular-nums">{rp(r.actual_value)}</span> },
    { id: "gap", header: "Gap", sortable: true, align: "right", accessor: (r) => r.gap_percent ?? -Infinity, cell: (r) => <GapBadge pct={r.gap_percent} /> },
    { id: "notes", header: "Catatan", cell: (r) => r.notes ?? <span className="text-muted-foreground text-xs">—</span> },
    {
      id: "aksi", header: "", align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <PurchaseForecastForm vendors={vendors} defaultYear={year} defaultMonth={month || 1} existing={r} onSaved={() => void muat()} />
          <Button size="sm" variant="outline" title="Hapus" onClick={() => hapus(r)}><Trash2 /></Button>
        </div>
      ),
    },
  ];

  const t = summary?.total;
  const k = summary?.klasifikasi;
  const tahunIni = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select aria-label="Bulan" className={selectCls} value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Setahun</option>
            {BULAN.map((b, i) => <option key={b} value={i + 1}>{b}</option>)}
          </select>
          <select aria-label="Tahun" className={selectCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[tahunIni - 2, tahunIni - 1, tahunIni, tahunIni + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <PurchaseForecastForm vendors={vendors} defaultYear={year} defaultMonth={month || new Date().getMonth() + 1} onSaved={() => void muat()} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Forecast"
          value={loading ? "…" : t && t.forecast_basis !== "kosong" ? rpRingkas(t.forecast_value) : "—"}
          delta={t?.forecast_basis === "semua" ? "dari baris semua lini & vendor" : t?.forecast_basis === "jumlah_baris" ? "jumlah semua baris forecast" : "belum ada forecast"}
          icon={Target}
        />
        <StatCard title="Realisasi PO" value={loading ? "…" : t ? rpRingkas(t.actual_value) : "—"} delta="PO Accurate, tanpa yang batal" icon={ShoppingCart} />
        <StatCard
          title="Gap"
          value={loading ? "…" : t?.gap_percent != null ? `${t.gap_percent > 0 ? "+" : ""}${t.gap_percent.toLocaleString("id-ID")}%` : "—"}
          delta={t && t.forecast_basis !== "kosong" ? rpRingkas(t.gap_value) : undefined}
          deltaTone={t?.gap_percent != null && t.gap_percent > 10 ? "negative" : "neutral"}
          icon={TrendingUpDown}
        />
        <StatCard
          title="Barang Terklasifikasi"
          value={loading ? "…" : k?.persen != null ? `${k.persen.toLocaleString("id-ID")}%` : "—"}
          delta="nilai PO yang punya lini & brand"
          deltaTone={k?.persen != null && k.persen < 70 ? "negative" : "neutral"}
          icon={Tags}
        />
      </div>

      {k?.persen != null && k.persen < 100 && (
        <p className="text-muted-foreground text-xs">
          Lini & brand diambil dari Klasifikasi Produk. {rpRingkas(k.actual_value - k.terklasifikasi_value)} PO periode ini belum terklasifikasi —
          lengkapi di menu Klasifikasi Produk supaya pecahan per lini & brand akurat.
        </p>
      )}

      <Tabs defaultValue="lini">
        <TabsList>
          <TabsTrigger value="lini">Per Lini</TabsTrigger>
          <TabsTrigger value="vendor">Per Vendor</TabsTrigger>
          <TabsTrigger value="brand">Per Brand</TabsTrigger>
          <TabsTrigger value="forecast">Daftar Forecast ({rows.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="lini" className="mt-4">
          <Card><CardContent className="pt-6"><DataTable columns={kolomRingkasan("Lini", true)} data={summary?.by_lini ?? []} getKey={(r) => r.key} pageSize={25} initialSort={{ id: "actual", dir: "desc" }} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="vendor" className="mt-4">
          <Card><CardContent className="pt-6"><DataTable columns={kolomRingkasan("Vendor", true)} data={summary?.by_vendor ?? []} getKey={(r) => r.key} searchPlaceholder="Cari vendor…" pageSize={25} initialSort={{ id: "actual", dir: "desc" }} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="brand" className="mt-4">
          <Card><CardContent className="pt-6"><DataTable columns={kolomRingkasan("Brand", false)} data={summary?.by_brand ?? []} getKey={(r) => r.key} searchPlaceholder="Cari brand…" pageSize={25} initialSort={{ id: "actual", dir: "desc" }} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="forecast" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {rows.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">Belum ada forecast di periode ini. Tambah lewat tombol Tambah Forecast.</p>
              ) : (
                <DataTable columns={kolomForecast} data={rows} getKey={(r) => r.id} pageSize={25} initialSort={{ id: "periode", dir: "desc" }} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {dialog}
    </div>
  );
}
