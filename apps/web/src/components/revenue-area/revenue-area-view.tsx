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
  biaya: number | null;
  labaKotor: number | null;
  hppCakupanPct: number | null;
  profit: number | null;
}

interface KantorPusat {
  operasional: number;
  sdm: number;
  luarUsaha: number;
  total: number;
  marketingFeeBelumTerpetakan: number;
}

interface Cakupan {
  total: number;
  tertandai: number;
  pct: number | null;
  perDasar: { dasar: string; jumlah: number }[];
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
  kantorPusat: KantorPusat | null;
  cakupan: Cakupan | null;
  terakhirSyncBiaya: string | null;
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

const Rp = ({ v }: { v: number | null }) =>
  v == null ? <span className="text-muted-foreground">—</span> : <span className={cn("tabular-nums", v < 0 && "text-red-600")}>{formatRupiah(v)}</span>;

const tgl = (iso: string) => iso.split("-").reverse().join("/");

// Revenue netto (tanpa PPN) per area vs periode sebelumnya. Dipakai tab "Revenue Area"
// WatchPoint dan menu /profitabilitas-area; `endpoint` = route BFF masing-masing (izin
// dicek di route). Biaya = akun 6200 (operasional) yang ditandai area oleh aturan Direktur;
// laba kotor = revenue − HPP wrg-os (parsial, lihat cakupan HPP). Belum ada data biaya → "—".
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
                          <TableHead className="text-right">Laba kotor</TableHead>
                          <TableHead className="text-right">Biaya operasional</TableHead>
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
                            <TableCell className="text-right">
                              <Rp v={r.labaKotor} />
                              {r.hppCakupanPct != null && r.hppCakupanPct < 100 ? (
                                <div className="text-muted-foreground text-[11px]" title="Porsi revenue yang punya HPP tak ambigu di tabel HPP">
                                  HPP {r.hppCakupanPct.toFixed(0)}% revenue
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">
                              <Rp v={r.biaya} />
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              <Rp v={r.profit} />
                            </TableCell>
                          </>
                        ) : null}
                      </TableRow>
                    ))}
                    {tampilkanBiaya && data.kantorPusat ? (
                      <TableRow className="bg-muted/40">
                        <TableCell className="font-medium">KANTOR PUSAT</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground text-right" colSpan={4}>
                          Tanpa revenue. Biaya tak ber-area, gaji (6100), dan biaya luar usaha (6300) — tidak dibagi.
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right">—</TableCell>
                        <TableCell className="text-right" title={`Operasional ${formatRupiah(data.kantorPusat.operasional)} · SDM ${formatRupiah(data.kantorPusat.sdm)} · Luar usaha ${formatRupiah(data.kantorPusat.luarUsaha)}`}>
                          <Rp v={data.kantorPusat.total} />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <Rp v={-data.kantorPusat.total} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {tampilkanBiaya && !data.biayaTersedia ? (
            <p className="text-muted-foreground text-xs">
              Biaya &amp; profit/rugi menunggu data biaya dari Accurate (sinkron biaya belum jalan atau belum ada biaya pada periode ini).
            </p>
          ) : null}

          {tampilkanBiaya && data.biayaTersedia ? (
            <div className="space-y-2">
              {data.cakupan ? (
                <Card>
                  <CardContent className="space-y-1 py-3 text-sm">
                    <div>
                      <span className="font-medium">Cakupan penandaan area: {data.cakupan.pct != null ? `${data.cakupan.pct.toFixed(1)}%` : "—"}</span>{" "}
                      <span className="text-muted-foreground">
                        dari biaya operasional {formatRupiah(data.cakupan.total)}; sisanya jatuh ke Kantor Pusat sampai Accounting mengisi Departemen = area.
                      </span>
                    </div>
                    {data.cakupan.perDasar.length > 0 ? (
                      <div className="text-muted-foreground text-xs">
                        {data.cakupan.perDasar.map((d) => `${d.dasar}: ${formatRupiah(d.jumlah)}`).join(" · ")}
                      </div>
                    ) : null}
                    {data.kantorPusat && data.kantorPusat.marketingFeeBelumTerpetakan > 0 ? (
                      <div className="text-xs text-amber-600">
                        Marketing fee belum terpetakan ke area: {formatRupiah(data.kantorPusat.marketingFeeBelumTerpetakan)} (menunggu peta INV → customer dari Finance; tidak ditebak).
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Laba kotor = revenue netto − HPP (tabel HPP wrg-os; hanya item ber-HPP tak ambigu, jadi parsial). Biaya = akun 6200 saja. Profit = laba kotor − biaya
                operasional.
                {data.terakhirSyncBiaya ? ` Biaya terakhir disinkron ${new Date(data.terakhirSyncBiaya).toLocaleString("id-ID")}.` : ""}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
