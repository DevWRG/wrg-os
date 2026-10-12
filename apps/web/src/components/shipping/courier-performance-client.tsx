"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Truck, PackageCheck, Clock, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isoWib } from "@/lib/tanggal-wib";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { StatCard } from "@/components/dashboard/stat-card";

interface KurirPerformaAngka {
  total: number;
  dalam_perjalanan: number;
  diterima: number;
  selesai: number;
  avg_jam_terima: number | null;
  avg_jam_bast: number | null;
  avg_km: number | null;
}

export interface KurirPerformaRow extends KurirPerformaAngka {
  kurir: string;
  terakhir_kirim: string | null;
}

export interface KurirPerformaSummary {
  from: string | null;
  to: string | null;
  overall: KurirPerformaAngka;
  by_kurir: KurirPerformaRow[];
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
  return { from: isoWib(from), to: isoWib(to) };
}

// Durasi disimpan dalam jam; di bawah 2 hari tampil jam, selebihnya hari.
export function formatDurasi(jam: number | null): string {
  if (jam == null) return "—";
  if (jam < 48) return `${jam.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
  return `${(jam / 24).toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari`;
}

const durasiCell = (jam: number | null) =>
  jam != null ? <span className="tabular-nums">{formatDurasi(jam)}</span> : <span className="text-muted-foreground">—</span>;

const rankingColumns: DataColumn<KurirPerformaRow>[] = [
  { id: "kurir", header: "Kurir", sortable: true, accessor: (r) => r.kurir, cell: (r) => <span className="font-medium">{r.kurir}</span> },
  { id: "total", header: "Kiriman", sortable: true, accessor: (r) => r.total, align: "right" },
  { id: "dalam_perjalanan", header: "Di Jalan", sortable: true, accessor: (r) => r.dalam_perjalanan, align: "right" },
  { id: "diterima", header: "Diterima", sortable: true, accessor: (r) => r.diterima, align: "right" },
  { id: "selesai", header: "BAST", sortable: true, accessor: (r) => r.selesai, align: "right" },
  { id: "avg_jam_terima", header: "Rata² Kirim→Terima", sortable: true, accessor: (r) => r.avg_jam_terima ?? -1, align: "right", cell: (r) => durasiCell(r.avg_jam_terima) },
  { id: "avg_jam_bast", header: "Rata² Kirim→BAST", sortable: true, accessor: (r) => r.avg_jam_bast ?? -1, align: "right", cell: (r) => durasiCell(r.avg_jam_bast) },
  {
    id: "avg_km", header: "Rata² Jarak", sortable: true, accessor: (r) => r.avg_km ?? -1, align: "right",
    cell: (r) => (r.avg_km != null ? <span className="tabular-nums">{r.avg_km} km</span> : <span className="text-muted-foreground">—</span>),
  },
];

export function CourierPerformanceClient({ initialSummary }: { initialSummary: KurirPerformaSummary | null }) {
  const [period, setPeriod] = useState("30");
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const pertama = useRef(true);

  const loadSummary = useCallback(async () => {
    const { from, to } = periodRange(period);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setLoading(true);
    try {
      const res = await fetch(`/api/courier-performance/summary?${qs.toString()}`, { cache: "no-store" });
      setSummary(res.ok ? ((await res.json()) as KurirPerformaSummary) : null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // Periode awal (30 hari) sudah diambil server — fetch ulang hanya saat periode diganti.
    if (pertama.current) {
      pertama.current = false;
      return;
    }
    void loadSummary();
  }, [loadSummary]);

  if (!initialSummary && !summary) {
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectCls} aria-label="Periode">
          {PERIOD_OPTIONS.map((o2) => (
            <option key={o2.value} value={o2.value}>{o2.label}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Kiriman"
          value={loading ? "…" : String(o?.total ?? 0)}
          delta={o ? `${o.dalam_perjalanan} masih di jalan` : undefined}
          icon={Truck}
        />
        <StatCard
          title="Selesai BAST"
          value={loading ? "…" : String(o?.selesai ?? 0)}
          delta={o ? `${o.diterima} sudah diterima` : undefined}
          icon={PackageCheck}
        />
        <StatCard title="Rata² Kirim→Terima" value={loading ? "…" : formatDurasi(o?.avg_jam_terima ?? null)} icon={Timer} />
        <StatCard title="Rata² Kirim→BAST" value={loading ? "…" : formatDurasi(o?.avg_jam_bast ?? null)} icon={Clock} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performa per Kurir</CardTitle>
        </CardHeader>
        <CardContent>
          {!summary || summary.by_kurir.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Belum ada kiriman di periode ini. Data muncul begitu kurir mengirim #KIRIM di WA — rincian per SJ di{" "}
              <Link href="/shipment-tracking" className="underline">Tracking Pengiriman</Link>.
            </p>
          ) : (
            <DataTable
              columns={rankingColumns}
              data={summary.by_kurir}
              getKey={(r) => r.kurir.toLowerCase()}
              searchPlaceholder="Cari kurir…"
              pageSize={25}
              initialSort={{ id: "total", dir: "desc" }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
