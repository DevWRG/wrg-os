"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/pricelist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard } from "@/components/ui/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Tipe di-mirror dari apps/api/src/repo/revenue-area.ts.
type Periode = "bulan" | "kuartal" | "tahun";
type Region = "OFFICE" | "West" | "East";

interface Row {
  cabang: string;
  region: Region;
  revenue: number;
  revenuePrev: number;
  deltaPct: number | null;
  sharePct: number;
}

interface Hasil {
  periode: Periode;
  asOf: string;
  cur: { from: string; to: string };
  prev: { from: string; to: string };
  total: number;
  totalPrev: number;
  deltaPct: number | null;
  regions: { region: Region; revenue: number; revenuePrev: number; deltaPct: number | null }[];
  rows: Row[];
  biayaTersedia: boolean;
}

const PERIODES: { key: Periode; label: string }[] = [
  { key: "bulan", label: "Bulan ini" },
  { key: "kuartal", label: "Kuartal ini" },
  { key: "tahun", label: "Tahun ini" },
];

const REGION_LABEL: Record<Region, string> = { East: "East", West: "West", OFFICE: "Lainnya / Office" };

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const naik = v >= 0;
  const Ikon = naik ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", naik ? "text-emerald-600" : "text-red-600")}>
      <Ikon className="size-3.5" /> {naik ? "+" : ""}
      {v.toFixed(1)}%
    </span>
  );
}

const tgl = (iso: string) => iso.split("-").reverse().join("/");

// Revenue netto (tanpa PPN) per area vs periode sebelumnya. Dipakai tab "Revenue Area"
// WatchPoint dan menu /profitabilitas-area; `endpoint` = route BFF masing-masing (izin
// dicek di route). Kolom Biaya & Profit sengaja kosong sampai data biaya Accurate masuk
// (BRIEF-F150-DATA-BIAYA-ACCURATE.md) — "—", bukan nol palsu.
export function RevenueAreaView({ endpoint, tampilkanBiaya = false }: { endpoint: string; tampilkanBiaya?: boolean }) {
  const [periode, setPeriode] = useState<Periode>("bulan");
  // Hasil disimpan bersama periodenya; "memuat" = hasil terakhir bukan untuk periode terpilih.
  const [hasil, setHasil] = useState<{ periode: Periode; data: Hasil | null; err: string | null } | null>(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      let data: Hasil | null = null;
      let err: string | null = null;
      try {
        const r = await fetch(`${endpoint}?periode=${periode}`, { cache: "no-store" });
        if (r.ok) data = (await r.json()) as Hasil;
        else err = r.status === 403 ? "Tidak punya akses." : `Gagal memuat (${r.status}).`;
      } catch {
        err = "Server tidak terjangkau.";
      }
      if (!batal) setHasil({ periode, data, err });
    })();
    return () => {
      batal = true;
    };
  }, [endpoint, periode]);

  const loading = hasil?.periode !== periode;
  const data = hasil?.data ?? null;
  const err = loading ? null : (hasil?.err ?? null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {PERIODES.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriode(p.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              periode === p.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && !data ? <LoadingCard /> : null}
      {err ? <EmptyState title="Tidak bisa menampilkan data" description={err} /> : null}

      {data ? (
        <>
          <p className="text-muted-foreground text-xs">
            Revenue netto (tanpa PPN) {tgl(data.cur.from)}–{tgl(data.cur.to)} dibanding {tgl(data.prev.from)}–{tgl(data.prev.to)}. Cabang menurut
            AM pada tanggal faktur; faktur tanpa AM ikut area lokasi customer.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-muted-foreground text-xs font-medium">Total revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold tabular-nums">{formatRupiah(data.total)}</div>
                <Delta v={data.deltaPct} />
              </CardContent>
            </Card>
            {data.regions.map((g) => (
              <Card key={g.region}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-muted-foreground text-xs font-medium">Region {REGION_LABEL[g.region]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold tabular-nums">{formatRupiah(g.revenue)}</div>
                  <Delta v={g.deltaPct} />
                </CardContent>
              </Card>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <EmptyState title="Belum ada faktur" description="Tidak ada faktur pada periode ini untuk area yang boleh Anda lihat." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Area (cabang)</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Revenue netto</TableHead>
                      <TableHead className="text-right">Periode lalu</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead className="text-right">Porsi</TableHead>
                      {tampilkanBiaya ? (
                        <>
                          <TableHead className="text-right">Biaya</TableHead>
                          <TableHead className="text-right">Profit / rugi</TableHead>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.cabang}>
                        <TableCell className="font-medium">{r.cabang}</TableCell>
                        <TableCell>{REGION_LABEL[r.region]}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(r.revenue)}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">{formatRupiah(r.revenuePrev)}</TableCell>
                        <TableCell className="text-right">
                          <Delta v={r.deltaPct} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                              <div className="bg-primary h-full" style={{ width: `${Math.min(100, r.sharePct)}%` }} />
                            </div>
                            <span className="w-12 tabular-nums">{r.sharePct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                        {tampilkanBiaya ? (
                          <>
                            <TableCell className="text-muted-foreground text-right">—</TableCell>
                            <TableCell className="text-muted-foreground text-right">—</TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {tampilkanBiaya && !data.biayaTersedia ? (
            <p className="text-muted-foreground text-xs">
              Biaya &amp; profit/rugi menunggu data biaya dari Accurate (akun beban per area). Profit = revenue netto − biaya operasional, tanpa HPP.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
