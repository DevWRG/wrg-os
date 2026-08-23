"use client";

// Panel RINGKASAN — kartu angka + grafik. Dirender sebagai tab oleh
// produktivitas-tabs.tsx, yang memegang keadaan filter dan merender FilterBarKso;
// panel ini hanya MENERIMA `f`. `data` tetap dibutuhkan karena tren bulanan
// (data.tren) berada di luar cakupan filter per-faskes.

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis, LabelList,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Kosong, PENANDA, Pilih, Statistik, awalTahunIni, bulanIni, deretBulan,
  labelBulan, rpSingkat, skemaPakaiRpTes, type FilterKso, type KsoProduktivitas,
} from "./produktivitas-shared";

export function KsoRingkasanPanel({ f, data }: { f: FilterKso; data: KsoProduktivitas }) {
  const { rows, median, skema } = f;

  const total = useMemo(() => {
    let revenue = 0, tes = 0, alat = 0, tertanda = 0;
    for (const g of rows) {
      revenue += g.r.revenueNettoCustomer ?? 0;
      tes += g.r.totalTesCustomerSeskema ?? 0;
      alat += g.r.alatSeskemaDiCustomer ?? g.alatList.length;
      if (PENANDA.some((p) => p.uji(g.r))) tertanda++;
    }
    return { revenue, tes, alat, tertanda };
  }, [rows]);

  // ── Tren bulanan ────────────────────────────────────────────────
  // Tren datang dari kso_tren_bulanan_v (migrasi 106) yang cakupannya SELURUH faskes
  // pada skema ini — ia TIDAK ikut filter kota/brand/alat/penanda, karena view-nya sudah
  // teragregasi per bulan dan tidak menyimpan asal-usul per faskes. Itu disebut
  // eksplisit di kartunya; kalau tidak, orang akan mengira grafiknya rusak saat
  // memfilter satu kota dan garisnya tidak bergerak.
  //
  // DEFAULT = Januari tahun berjalan s/d bulan ini (permintaan user 2026-08-18).
  // Bukan "semua data": sheet memuat 2025 sementara mirror faktur Accurate baru mulai
  // 2026, jadi rentang penuh selalu membuka dengan separuh grafik revenue kosong —
  // pemandangan yang terbaca sebagai kerusakan, bukan sebagai batas data.
  const semuaPeriode = useMemo(
    () => [...new Set(data.tren.map((t) => t.periode))].sort(),
    [data.tren],
  );
  const [dari, setDari] = useState(awalTahunIni);
  const [sampai, setSampai] = useState(bulanIni);

  // Pilihan bulan digabung dari periode yang ADA di data DAN deret default, supaya
  // "bulan ini" tetap bisa dipilih walau belum ada satu pun baris untuknya.
  const opsiBulan = useMemo(
    () => [...new Set([...semuaPeriode, ...deretBulan(awalTahunIni(), bulanIni())])].sort(),
    [semuaPeriode],
  );

  const tren = useMemo(() => {
    const per = new Map(data.tren.filter((t) => t.skema === skema).map((t) => [t.periode, t]));
    // Dirangka dari DERET LENGKAP, bukan dari baris yang ada: bulan tanpa data harus
    // menempati tempatnya di sumbu-x sebagai putusnya garis, bukan lenyap sehingga dua
    // bulan yang berjauhan terlihat bersebelahan.
    return deretBulan(dari, sampai).map((p) => {
      const t = per.get(p);
      return {
        periode: p, label: labelBulan(p),
        tes: t?.jumlahTes ?? null,
        revenue: t?.revenueNetto ?? null,
        faskes: t?.faskesLapor ?? null,
      };
    });
  }, [data.tren, skema, dari, sampai]);

  const adaTes = tren.some((t) => t.tes !== null);
  const adaRevenue = tren.some((t) => t.revenue !== null);

  const preset = (d: string, s2: string) => () => { setDari(d); setSampai(s2); };
  const rentangPenuh = semuaPeriode.length
    ? { d: semuaPeriode[0], s: semuaPeriode[semuaPeriode.length - 1] } : null;

  // ── 10 faskes revenue terbesar (magnitude → batang) ─────────────
  const top10 = useMemo(
    () => [...rows]
      .filter((g) => (g.r.revenueNettoCustomer ?? 0) > 0)
      .sort((a, b) => (b.r.revenueNettoCustomer ?? 0) - (a.r.revenueNettoCustomer ?? 0))
      .slice(0, 10)
      .map((g) => ({
        nama: g.faskes.length > 26 ? g.faskes.slice(0, 25) + "…" : g.faskes,
        penuh: g.faskes,
        revenue: Math.round(g.r.revenueNettoCustomer ?? 0),
      })),
    [rows],
  );

  // ── Sebaran Rp/tes relatif median ───────────────────────────────
  // Patokan MEDIAN, bukan rata-rata: sebaran Rp/tes sangat miring (segelintir faskes
  // puluhan kali lipat), jadi rata-rata tertarik outlier dan hampir semua faskes akan
  // tampak "di bawah rata-rata".
  const sebaran = useMemo(() => {
    if (!median) return [];
    const band = [
      { id: "<0,5×",  uji: (x: number) => x < 0.5 },
      { id: "0,5–1×", uji: (x: number) => x >= 0.5 && x < 1 },
      { id: "1–2×",   uji: (x: number) => x >= 1 && x < 2 },
      { id: "2–5×",   uji: (x: number) => x >= 2 && x < 5 },
      { id: "≥5×",    uji: (x: number) => x >= 5 },
    ];
    const nilai = rows.map((g) => g.r.rupiahPerTesCustomer)
      .filter((v): v is number => v !== null && v > 0).map((v) => v / median);
    return band.map((b) => ({ band: b.id, jumlah: nilai.filter(b.uji).length }));
  }, [rows, median]);

  // Faskes yang LOLOS pagar penyebut tapi tidak punya Rp/tes tidak bisa masuk histogram —
  // tak ada nilai untuk dibandingkan ke median. Akibatnya jumlah batang selalu lebih kecil
  // dari kartu "Faskes" di atasnya (71 vs 68 dan 82 vs 77 pada data 2026-08-18), dan orang
  // yang menjumlahkan batangnya menemukan selisih tanpa penjelasan. Dihitung, bukan ditulis
  // tetap, supaya ikut bergerak saat pemetaan bertambah dan hilang sendiri kalau nol.
  //
  // Sengaja `!rupiahPerTesCustomer` (menangkap 0 juga), agar sepadan dengan filter `v > 0`
  // milik histogram di atas.
  const tanpaRpTes = rows.filter((g) => !g.r.rupiahPerTesCustomer).length;

  const cfg = {
    tes: { label: "Jumlah tes", color: "var(--chart-2)" },
    revenue: { label: "Revenue netto", color: "var(--chart-1)" },
    jumlah: { label: "Faskes", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistik label="Faskes" nilai={rows.length.toLocaleString("id-ID")}
          catatan={`${total.alat.toLocaleString("id-ID")} alat`} />
        <Statistik label="Revenue netto" nilai={"Rp " + rpSingkat(total.revenue)}
          catatan="tanpa PPN, skema ini saja" />
        <Statistik label="Total tes" nilai={total.tes.toLocaleString("id-ID")}
          catatan="realisasi di alat" />
        <Statistik label="Perlu diperiksa" nilai={total.tertanda.toLocaleString("id-ID")}
          catatan="faskes berpenanda" tekan={total.tertanda > 0} />
      </div>

      {/* ── Rentang tren ─────────────────────────────────────────────────────
          Kontrolnya diletakkan DI SINI, bukan di FilterBarKso, karena hanya dua
          grafik tren yang mematuhinya. Menaruhnya bersama Kota/Brand/Alat akan
          menyiratkan seluruh halaman ikut berubah — padahal kartu angka, 10 besar,
          dan histogram memakai agregat seluruh periode. */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <Pilih label="Tren dari" value={dari} onChange={setDari}>
            {opsiBulan.map((p) => <option key={p} value={p}>{labelBulan(p)}</option>)}
          </Pilih>
          <Pilih label="sampai" value={sampai} onChange={setSampai}>
            {opsiBulan.map((p) => <option key={p} value={p}>{labelBulan(p)}</option>)}
          </Pilih>
          <div className="flex flex-wrap gap-1.5 pb-1">
            <Preset aktif={dari === awalTahunIni() && sampai === bulanIni()}
              onClick={preset(awalTahunIni(), bulanIni())}>Tahun berjalan</Preset>
            {rentangPenuh ? (
              <Preset aktif={dari === rentangPenuh.d && sampai === rentangPenuh.s}
                onClick={preset(rentangPenuh.d, rentangPenuh.s)}>Semua data</Preset>
            ) : null}
          </div>
          {dari > sampai ? (
            <span className="pb-1 text-xs text-amber-600">
              Bulan awal melewati bulan akhir — grafik dikosongkan.
            </span>
          ) : (
            <span className="text-muted-foreground pb-1 text-xs">
              {tren.length} bulan
            </span>
          )}
        </CardContent>
      </Card>

      {/* ── Tren bulanan: DUA grafik terpisah, bukan satu dengan dua sumbu ──────
          Jumlah tes dan rupiah beda skala beberapa ordo; menumpuknya pada satu bidang
          dengan sumbu kiri-kanan membuat perpotongan garis terlihat bermakna padahal
          sepenuhnya artefak pilihan skala. Dua grafik bersusun, sumbu-x sama. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tren jumlah tes per bulan</CardTitle>
          </CardHeader>
          <CardContent>
            {adaTes ? (
              <ChartContainer config={cfg} className="aspect-auto h-[260px] w-full">
                <LineChart data={tren} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }}
                    interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11 }}
                    tickFormatter={(v) => rpSingkat(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent
                    formatter={(v) => [Number(v).toLocaleString("id-ID") + " tes", ""]} />} />
                  {/* connectNulls SENGAJA false: bulan tanpa laporan harus terlihat
                      putus, bukan disambung garis lurus yang mengesankan ada data. */}
                  <Line type="monotone" dataKey="tes" stroke="var(--color-tes)" strokeWidth={2}
                    dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                </LineChart>
              </ChartContainer>
            ) : <Kosong pesan="Belum ada laporan tes untuk skema ini." />}
            <p className="text-muted-foreground mt-1 text-xs">
              Titik yang putus = bulan itu <strong>tidak ada laporan</strong>, bukan nol tes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tren revenue netto per bulan</CardTitle>
          </CardHeader>
          <CardContent>
            {adaRevenue ? (
              <ChartContainer config={cfg} className="aspect-auto h-[260px] w-full">
                <LineChart data={tren} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }}
                    interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11 }}
                    tickFormatter={(v) => rpSingkat(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent
                    formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), ""]} />} />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2}
                    dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                </LineChart>
              </ChartContainer>
            ) : <Kosong pesan="Belum ada faktur untuk skema ini." />}
            <p className="text-muted-foreground mt-1 text-xs">
              Mirror faktur Accurate mulai 2026 — bulan sebelum itu kosong karena
              <strong> datanya tidak ada</strong>, bukan karena tidak ada penjualan.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-300">
        <CardContent className="flex items-start gap-2 py-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            Dua grafik tren di atas mengikuti <strong>Skema</strong> dan <strong>rentang bulan</strong>
            saja — filter kota, brand, alat, dan penanda <strong>tidak</strong> mempengaruhinya,
            karena sumbernya sudah teragregasi per bulan di tingkat basis data. Sebaliknya,
            kartu angka dan dua grafik di bawah ikut seluruh filter tapi <strong>tidak</strong>
            ikut rentang bulan — angkanya selalu agregat seluruh periode.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">10 faskes revenue terbesar</CardTitle></CardHeader>
          <CardContent>
            {top10.length ? (
              <ChartContainer config={cfg} className="aspect-auto h-[320px] w-full">
                <BarChart data={top10} layout="vertical" margin={{ left: 4, right: 56, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="revenue" hide />
                  <YAxis type="category" dataKey="nama" width={150} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent
                    labelFormatter={(_, p) => String(p?.[0]?.payload?.penuh ?? "")}
                    formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), " revenue netto"]} />} />
                  <Bar dataKey="revenue" fill="var(--color-jumlah)" radius={[0, 4, 4, 0]} barSize={16}>
                    <LabelList dataKey="revenue" position="right" offset={8}
                      className="fill-muted-foreground" fontSize={11}
                      formatter={(v) => (typeof v === "number" ? rpSingkat(v) : "")} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : <Kosong />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Sebaran Rp/tes terhadap median</CardTitle></CardHeader>
          <CardContent>
            {sebaran.length ? (
              <ChartContainer config={cfg} className="aspect-auto h-[320px] w-full">
                <BarChart data={sebaran} margin={{ left: 4, right: 4, top: 20, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="band" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis hide />
                  {/* Garis median berdiri di batas 1x — memberi tahu sisi mana yang
                      "di atas median" tanpa harus membaca label sumbu. */}
                  <ReferenceLine x="1–2×" stroke="var(--border)" strokeDasharray="4 4" />
                  <ChartTooltip content={<ChartTooltipContent
                    labelFormatter={(l) => `${l} median`}
                    formatter={(v) => [`${v} faskes`, ""]} />} />
                  <Bar dataKey="jumlah" fill="var(--color-jumlah)" radius={[4, 4, 0, 0]} maxBarSize={56}>
                    <LabelList dataKey="jumlah" position="top" offset={6}
                      className="fill-muted-foreground" fontSize={11} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              /* Untuk BELI_REAGEN histogram ini TIDAK bisa dipercaya, dan sebabnya harus
                 disebut alih-alih dibiarkan sebagai "median belum tersedia": median-nya
                 lahir dari 4 faskes yang melapor tes dari 329 alat. Sebaran terhadap
                 patokan yang mewakili 1% populasi lebih menyesatkan daripada kosong. */
              <Kosong pesan={skemaPakaiRpTes(skema)
                ? "Median belum tersedia untuk skema ini."
                : "Tidak berlaku: skema beli-reagen tak punya Rp/tes (4 dari 329 alat melapor tes), jadi tak ada median yang mewakili."} />
            )}
            {skemaPakaiRpTes(skema) ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Patokannya <strong>median</strong>, bukan rata-rata — sebaran Rp/tes sangat miring,
                dan rata-rata akan tertarik segelintir faskes yang puluhan kali lipat.
              </p>
            ) : null}
            {skemaPakaiRpTes(skema) && tanpaRpTes > 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {tanpaRpTes} faskes tidak masuk histogram karena belum punya Rp/tes — revenue
                Accurate-nya nol atau belum terpetakan, jadi tak ada nilai untuk dibandingkan ke
                median. Jumlah batang ({rows.length - tanpaRpTes}) karena itu lebih kecil dari
                kartu <em>Faskes</em> ({rows.length}).
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Preset({ children, aktif, onClick }: {
  children: React.ReactNode; aktif: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={
        "rounded-md border px-2 py-1 text-xs transition-colors " +
        (aktif
          ? "border-primary/40 bg-primary/10 text-primary font-medium"
          : "border-input bg-card text-muted-foreground hover:text-foreground")
      }>
      {children}
    </button>
  );
}
