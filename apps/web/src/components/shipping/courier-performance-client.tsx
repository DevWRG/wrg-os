"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { StatCard } from "@/components/dashboard/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourierDeliveryTable, type CourierDeliveryRow } from "./courier-delivery-table";

export interface CourierPerformanceRow {
  kurir_name: string;
  total: number;
  selesai_count: number;
  dalam_perjalanan_count: number;
  bermasalah_count: number;
  late_count: number;
  on_time_rate_pct: number | null;
  avg_duration_days: number | null;
}

export interface CourierPerformanceSummary {
  from: string | null;
  to: string | null;
  overall: {
    total: number;
    selesai_count: number;
    dalam_perjalanan_count: number;
    bermasalah_count: number;
    late_count: number;
    overdue_count: number;
    on_time_rate_pct: number | null;
    avg_duration_days: number | null;
  };
  by_kurir: CourierPerformanceRow[];
}

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const PERIOD_OPTIONS = [
  { value: "7", label: "7 hari terakhir" },
  { value: "30", label: "30 hari terakhir" },
  { value: "90", label: "90 hari terakhir" },
  { value: "all", label: "Semua periode" },
];

function periodRange(preset: string): { from?: string; to?: string } {
  if (preset === "all") return {};
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (Number(preset) - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

const rankingColumns: DataColumn<CourierPerformanceRow>[] = [
  { id: "kurir_name", header: "Kurir/Ekspedisi", sortable: true, accessor: (r) => r.kurir_name, cell: (r) => <span className="font-medium">{r.kurir_name}</span> },
  { id: "total", header: "Total", sortable: true, accessor: (r) => r.total, align: "right" },
  { id: "selesai_count", header: "Selesai", sortable: true, accessor: (r) => r.selesai_count, align: "right" },
  { id: "bermasalah_count", header: "Bermasalah", sortable: true, accessor: (r) => r.bermasalah_count, align: "right" },
  { id: "late_count", header: "Telat", sortable: true, accessor: (r) => r.late_count, align: "right" },
  {
    id: "on_time_rate_pct", header: "On-Time Rate", sortable: true, accessor: (r) => r.on_time_rate_pct ?? -1, align: "right",
    cell: (r) => (r.on_time_rate_pct != null ? <span className="tabular-nums">{r.on_time_rate_pct}%</span> : <span className="text-muted-foreground">—</span>),
  },
  {
    id: "avg_duration_days", header: "Rata-rata Durasi", sortable: true, accessor: (r) => r.avg_duration_days ?? -1, align: "right",
    cell: (r) => (r.avg_duration_days != null ? <span className="tabular-nums">{r.avg_duration_days} hari</span> : <span className="text-muted-foreground">—</span>),
  },
];

export function CourierPerformanceClient({
  initialRows,
  initialSummary,
  hasData,
}: {
  initialRows: CourierDeliveryRow[];
  initialSummary: CourierPerformanceSummary | null;
  hasData: boolean;
}) {
  const [period, setPeriod] = useState("30");
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    const { from, to } = periodRange(period);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setLoading(true);
    try {
      const res = await fetch(`/api/courier-deliveries/summary?${qs.toString()}`, { cache: "no-store" });
      setSummary(res.ok ? ((await res.json()) as CourierPerformanceSummary) : null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // initialRows sengaja ikut jadi dependency (bukan cuma loadSummary/period):
    // gatewayFetch di page.tsx no-store, jadi setiap router.refresh() (dipanggil
    // add/edit/delete sheet) balikin array baru → trigger refetch summary utk
    // periode yg SEDANG dipilih user. Tanpa ini, ganti status lalu pindah ke
    // tab Dashboard Performa tampil data basi sampai reload manual.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadSummary() men-setState setelah fetch periode/data berubah; disengaja.
    void loadSummary();
  }, [loadSummary, initialRows]);

  if (!hasData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">
            Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const o = summary?.overall;

  return (
    <Tabs defaultValue="dashboard">
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard Performa</TabsTrigger>
        <TabsTrigger value="riwayat">Riwayat Pengiriman</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="mt-4 space-y-4">
        <div className="flex justify-end">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectCls}>
            {PERIOD_OPTIONS.map((o2) => (
              <option key={o2.value} value={o2.value}>{o2.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Pengiriman" value={loading ? "…" : String(o?.total ?? 0)} icon={Truck} />
          <StatCard
            title="On-Time Rate"
            value={loading ? "…" : o?.on_time_rate_pct != null ? `${o.on_time_rate_pct}%` : "—"}
            delta={o ? `${o.selesai_count} selesai · ${o.late_count} telat` : undefined}
            icon={CheckCircle2}
          />
          <StatCard
            title="Bermasalah / Lewat Target"
            value={loading ? "…" : String((o?.bermasalah_count ?? 0) + (o?.overdue_count ?? 0))}
            deltaTone={(o?.bermasalah_count ?? 0) + (o?.overdue_count ?? 0) > 0 ? "negative" : "neutral"}
            delta={o ? `${o.bermasalah_count} bermasalah · ${o.overdue_count} masih jalan lewat target` : undefined}
            icon={AlertTriangle}
          />
          <StatCard
            title="Rata-rata Durasi"
            value={loading ? "…" : o?.avg_duration_days != null ? `${o.avg_duration_days} hari` : "—"}
            icon={Clock}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranking Performa Kurir</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary || summary.by_kurir.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Belum ada data pengiriman di periode ini.</p>
            ) : (
              <DataTable
                columns={rankingColumns}
                data={summary.by_kurir}
                getKey={(r) => r.kurir_name}
                searchPlaceholder="Cari kurir…"
                pageSize={25}
                initialSort={{ id: "total", dir: "desc" }}
              />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="riwayat" className="mt-4">
        <Card>
          <CardContent className="pt-6">
            {initialRows.length === 0 ? (
              <p className="text-muted-foreground">Belum ada riwayat pengiriman. Tambah via tombol di atas.</p>
            ) : (
              <CourierDeliveryTable rows={initialRows} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
