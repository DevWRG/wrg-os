"use client";

// Dialog detail satu faskes — dibuka dengan mengklik baris tabel atau tombol
// "Lihat detail". Isinya: ringkasan angka, riwayat bulanan (tes & revenue), dan
// daftar alat beserta capaian targetnya.
//
// Dialog, BUKAN Sheet samping: mengikuti pola detail yang sudah dipakai Orders,
// Shipments, Suppliers, dan Customers (lihat CLAUDE.md).
//
// Data diambil SAAT DIBUKA, bukan ikut payload halaman. Riwayat bulanan seluruh faskes
// berarti ±189 faskes x 20 bulan x 2 skema di tiap muat halaman padahal yang dibuka
// paling banyak beberapa.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  PENANDA, Tag, deretBulan, labelBulan, num, rp, rpSingkat, type FaskesRow,
} from "./produktivitas-shared";

interface Detail {
  alat: {
    assetId: number; snKey: string; snRaw: string | null;
    typeAlat: string | null; namaAlat: string | null;
    targetJumlahTes: number | null; totalTes: number | null;
    rataTesBulanan: number | null; capaianTarget: number | null;
  }[];
  tren: { periode: string; jumlahTes: number | null; alatLapor: number | null; revenueNetto: number | null }[];
}

const cfg = {
  tes: { label: "Jumlah tes", color: "var(--chart-2)" },
  revenue: { label: "Revenue netto", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function FaskesDetailDialog({ g, median, onClose }: {
  g: FaskesRow | null; median: number | null; onClose: () => void;
}) {
  // Hasil disimpan BERSAMA kuncinya, bukan di-reset saat pilihan berganti. Me-reset
  // lewat setState sinkron di dalam effect memicu render berantai (dan ditolak lint);
  // dengan menyimpan kuncinya, data milik faskes lama otomatis dianggap belum siap
  // begitu kuncinya tidak cocok — tanpa satu pun setState tambahan.
  const kunci = g ? `${g.r.accountId}:${g.r.skema}` : null;
  const [hasil, setHasil] = useState<{ kunci: string; detail: Detail | null } | null>(null);

  useEffect(() => {
    // accountId null = faskes belum terpetakan ke Accurate; riwayat revenue-nya tidak
    // mungkin ada, jadi tidak usah memanggil backend sekadar untuk mendapat kosong.
    // Ditangani saat render, bukan lewat state.
    if (!kunci || !g || g.r.accountId === null) return;
    let batal = false;
    fetch(`/api/kso/produktivitas/faskes/${g.r.accountId}?skema=${encodeURIComponent(g.r.skema)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => { if (!batal) setHasil({ kunci, detail: d }); })
      .catch(() => { if (!batal) setHasil({ kunci, detail: null }); });
    return () => { batal = true; };
  }, [kunci, g]);

  if (!g) return null;
  const r = g.r;
  const siap = hasil !== null && hasil.kunci === kunci;
  const detail = siap ? hasil.detail : null;
  const gagal = siap && hasil.detail === null;

  // Sumbu-x dirangka dari deret bulan LENGKAP antara titik pertama & terakhir, sama
  // seperti grafik Ringkasan: tanpa itu bulan tanpa data lenyap dari sumbu sehingga dua
  // bulan berjauhan terlihat bersebelahan.
  const titik = detail?.tren ?? [];
  const seri = titik.length
    ? deretBulan(titik[0].periode, titik[titik.length - 1].periode).map((p) => {
        const t = titik.find((x) => x.periode === p);
        return { label: labelBulan(p), tes: t?.jumlahTes ?? null, revenue: t?.revenueNetto ?? null };
      })
    : [];
  const adaTes = seri.some((s) => s.tes !== null);
  const adaRev = seri.some((s) => s.revenue !== null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-words">{g.faskes}</DialogTitle>
          <p className="text-muted-foreground text-xs">
            {[g.kota, r.skema === "PER_TEST" ? "PER_TEST (KSO Tes)" : "BELI_REAGEN (KSO Reagen)"]
              .filter(Boolean).join(" · ")}
          </p>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Angka label="Tes (customer)" nilai={num(r.totalTesCustomerSeskema)} />
            <Angka label="Revenue netto" nilai={rp(r.revenueNettoCustomer)} />
            <Angka
              label="Rp / tes"
              nilai={rp(r.rupiahPerTesCustomer)}
              sub={median && r.rupiahPerTesCustomer
                ? `${(r.rupiahPerTesCustomer / median).toFixed(2)}× median` : undefined}
              redup={!r.basisTesMemadai}
            />
            <Angka label="Alat berbagi angka" nilai={String(r.alatSeskemaDiCustomer ?? g.alatList.length)} />
          </div>

          {PENANDA.some((p) => p.uji(r)) ? (
            <div className="flex flex-wrap gap-1.5">
              {!r.basisTesMemadai ? <Tag warna="merah" judul="Penyebut < 100 tes/thn — jangan dipakai memeringkat">penyebut tipis</Tag> : null}
              {r.tagihPolaDatar ? <Tag warna="kuning" judul="Qty Accurate datar tiap bulan = minimum kontrak, bukan hitungan tes">minimum kontrak</Tag> : null}
              {r.revenueTumpangTindih ? <Tag warna="biru" judul={`Faskes berskema ganda; porsi KSO ${r.porsiKso ?? "—"}`}>skema ganda</Tag> : null}
              {r.statusPenagihan === "tanpa_faktur" ? <Tag warna="merah" judul="Tidak ada faktur atas nama faskes ini">tanpa faktur</Tag> : null}
              {r.rasioTagihLapor !== null && Math.abs(r.rasioTagihLapor - 1) > 0.25
                ? <Tag warna="kuning" judul="Tes yang ditagihkan di Accurate menyimpang >25% dari yang dilaporkan">tagih/lapor {r.rasioTagihLapor.toFixed(2)}</Tag> : null}
            </div>
          ) : null}

          {r.accountId === null ? (
            <Catatan>
              Faskes ini <strong>belum terpetakan</strong> ke customer Accurate, jadi tidak ada
              riwayat revenue yang bisa ditampilkan. Yang tampil hanya angka dari sheet.
            </Catatan>
          ) : gagal ? (
            <Catatan>Gagal memuat detail. Coba tutup dan buka lagi.</Catatan>
          ) : !siap || detail === null ? (
            <div className="text-muted-foreground py-8 text-center text-xs">Memuat riwayat…</div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Grafik judul="Riwayat jumlah tes" ada={adaTes} kosong="Belum ada laporan tes.">
                  <LineChart data={seri} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                      interval="preserveStartEnd" minTickGap={14} />
                    <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10 }}
                      tickFormatter={(v) => rpSingkat(Number(v))} />
                    <ChartTooltip content={<ChartTooltipContent
                      formatter={(v) => [Number(v).toLocaleString("id-ID") + " tes", ""]} />} />
                    <Line type="monotone" dataKey="tes" stroke="var(--color-tes)" strokeWidth={2}
                      dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                  </LineChart>
                </Grafik>

                <Grafik judul="Riwayat revenue netto" ada={adaRev} kosong="Belum ada faktur.">
                  <LineChart data={seri} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                      interval="preserveStartEnd" minTickGap={14} />
                    <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10 }}
                      tickFormatter={(v) => rpSingkat(Number(v))} />
                    <ChartTooltip content={<ChartTooltipContent
                      formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), ""]} />} />
                    <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2}
                      dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                  </LineChart>
                </Grafik>
              </div>

              <p className="text-muted-foreground text-xs">
                Garis yang putus = bulan itu <strong>tidak ada laporan</strong>, bukan nol tes.
                Revenue kosong sebelum 2026 karena mirror faktur Accurate memang mulai 2026.
              </p>

              <div>
                <div className="mb-1.5 text-xs font-medium">Alat ({detail.alat.length})</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-border border-b text-left">
                        <th className="py-1.5 pr-2 font-medium">Alat</th>
                        <th className="py-1.5 pr-2 font-medium">SN</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Total tes</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Target/bln</th>
                        <th className="py-1.5 text-right font-medium">Capaian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.alat.map((a) => (
                        <tr key={a.assetId} className="border-border/60 border-b last:border-0">
                          <td className="py-1.5 pr-2">
                            <div className="font-medium">{a.namaAlat ?? "—"}</div>
                            <div className="text-muted-foreground">{a.typeAlat ?? ""}</div>
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-2">{a.snRaw ?? a.snKey}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{num(a.totalTes)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{num(a.targetJumlahTes)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {/* Capaian < 100% disorot: target itu komitmen kontrak, dan alat
                                yang jauh di bawahnya adalah alasan utama halaman ini ada. */}
                            {a.capaianTarget === null ? <span className="text-muted-foreground">—</span>
                              : <span className={cn(a.capaianTarget < 1 && "font-medium text-amber-600")}>
                                  {(a.capaianTarget * 100).toFixed(0)}%
                                </span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Angka({ label, nilai, sub, redup }: {
  label: string; nilai: string; sub?: string; redup?: boolean;
}) {
  return (
    <div className="border-border rounded-lg border p-2.5">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums", redup && "text-muted-foreground")}>{nilai}</div>
      {sub ? <div className="text-muted-foreground text-[11px]">{sub}</div> : null}
    </div>
  );
}

function Grafik({ judul, ada, kosong, children }: {
  judul: string; ada: boolean; kosong: string; children: React.ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{judul}</div>
      {ada ? (
        <ChartContainer config={cfg} className="aspect-auto h-[190px] w-full">{children}</ChartContainer>
      ) : (
        <div className="text-muted-foreground flex h-[190px] items-center justify-center text-xs">{kosong}</div>
      )}
    </div>
  );
}

function Catatan({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/50 p-2.5 text-xs">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p>{children}</p>
    </div>
  );
}
