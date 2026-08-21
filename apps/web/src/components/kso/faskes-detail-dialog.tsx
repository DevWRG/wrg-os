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
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  PENANDA, Tag, angkaSumbu, awalTahunIni, bulanIni, deretBulan, labelBulan, num, rp,
  skalaRp, type FaskesRow,
} from "./produktivitas-shared";

interface Detail {
  alat: {
    assetId: number; snKey: string; snRaw: string | null;
    typeAlat: string | null; namaAlat: string | null;
    targetJumlahTes: number | null; totalTes: number | null;
    rataTesBulanan: number | null; capaianTarget: number | null;
  }[];
  tren: { periode: string; jumlahTes: number | null; alatLapor: number | null; revenueNetto: number | null }[];
  trenAlat: { assetId: number; periode: string; jumlahTes: number | null }[];
  reagen: {
    itemId: number | null; itemNo: string | null; itemNama: string | null;
    jenisAlat: string | null; kategori: string; unit: string;
    qty: number | null; nilaiNetto: number | null; jumlahFaktur: number | null;
    dalamSkema: boolean;
  }[];
}

const cfg = {
  tes: { label: "Realisasi", color: "var(--chart-2)" },
  // Target digambar dengan warna NETRAL dan garis putus-putus, bukan warna seri kedua:
  // ia patokan, bukan pengukuran yang setara. Bentuknya (putus-putus, datar) yang
  // membedakan, sehingga tetap terbaca oleh mata yang sulit membedakan warna.
  target: { label: "Target", color: "var(--muted-foreground)" },
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
    // Jendela dikirim EKSPLISIT, jendela yang sama dengan grafik di bawah. Kalau server
    // menghitung "tahun berjalan" sendiri, daftar reagen bisa memakai periode berbeda
    // dari grafiknya tanpa ada yang menandai.
    fetch(`/api/kso/produktivitas/faskes/${g.r.accountId}?skema=${encodeURIComponent(g.r.skema)}`
      + `&dari=${awalTahunIni()}&sampai=${bulanIni()}`)
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
  // JENDELA = TAHUN BERJALAN (permintaan user 2026-08-19), bukan seluruh rentang data.
  // Alasannya kelihatan di layar: sheet memuat 2025 sementara mirror faktur Accurate baru
  // mulai 2026, jadi rentang penuh selalu membuka dengan separuh grafik revenue kosong —
  // terbaca sebagai kerusakan, bukan sebagai batas data. Memakai tahun BERJALAN, bukan
  // '2026' yang dipatok, supaya tidak jadi salah sendiri tahun depan.
  const dari = awalTahunIni();
  const sampai = bulanIni();
  const dalamJendela = (p: string) => p >= dari && p <= sampai;

  const titik = (detail?.tren ?? []).filter((t) => dalamJendela(t.periode));
  // Data yang ADA tapi di luar jendela — dipakai membedakan "belum pernah ada laporan"
  // dari "ada laporan, tapi bukan tahun ini". Tanpa ini alat yang berhenti dipakai akhir
  // 2025 tampil sama persis dengan alat yang tidak punya riwayat sama sekali.
  const luarJendela = (detail?.tren ?? []).filter((t) => !dalamJendela(t.periode));
  const adaTesLama = luarJendela.some((t) => t.jumlahTes !== null);
  const adaRevLama = luarJendela.some((t) => t.revenueNetto !== null);

  const seri = deretBulan(dari, sampai).length
    ? deretBulan(dari, sampai).map((p) => {
        const t = titik.find((x) => x.periode === p);
        return { label: labelBulan(p), tes: t?.jumlahTes ?? null, revenue: t?.revenueNetto ?? null };
      })
    : [];
  // `seri` kini hanya melayani grafik REVENUE (level faskes). Grafik tes dipecah per
  // alat dan masing-masing merangka deret bulannya sendiri dari trenAlat.
  const adaRev = seri.some((s) => s.revenue !== null);
  // Skala dihitung dari nilai terbesar di jendela ini, bukan tetap — lihat skalaRp().
  const skalaRev = skalaRp(Math.max(0, ...seri.map((x) => x.revenue ?? 0)));

  // Total & hitungan di luar skema dipakai di dua tempat (judul + catatan), jadi dihitung
  // sekali. Total mencakup baris di luar skema — itu memang "reagen yang keluar",
  // pertanyaan yang berbeda dari "revenue skema ini".
  // DUA subtotal, bukan satu. Yang "dalam skema" sepadan dengan kartu Revenue di atas
  // (kategori difilter + porsi KSO diterapkan di server); yang "di luar skema" TIDAK
  // masuk angka itu. Menampilkan satu total gabungan membuat pembaca membandingkannya
  // dengan kartu Revenue dan menemukan selisih tanpa sebab yang terlihat.
  const rgn = detail?.reagen ?? [];
  const totalDalam = rgn.filter((r) => r.dalamSkema).reduce((a, r) => a + (r.nilaiNetto ?? 0), 0);
  const totalLuar = rgn.filter((r) => !r.dalamSkema).reduce((a, r) => a + (r.nilaiNetto ?? 0), 0);
  const reagenLuar = rgn.filter((r) => !r.dalamSkema).length;

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
          {/* CAKUPAN KARTU vs GRAFIK BERBEDA, dan itu wajib tertulis.
              Kartu memakai angka level view = SELURUH periode (sumber yang sama dengan
              peringkat di tabel, dan penyebut Rp/tes-nya). Grafik di bawah dibatasi tahun
              berjalan atas permintaan user. Tanpa label ini pembaca menjumlahkan titik
              grafik, membandingkannya dengan kartu, dan menemukan selisih tanpa sebab yang
              terlihat — pada AMIN MEDICAL: kartu 671 tes vs grafik ~390 (2026 saja). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Angka label="Tes (customer)" nilai={num(r.totalTesCustomerSeskema)}
              sub="seluruh periode" />
            <Angka label="Revenue netto" nilai={rp(r.revenueNettoCustomer)}
              sub="seluruh periode" />
            <Angka
              label="Rp / tes"
              nilai={rp(r.rupiahPerTesCustomer)}
              sub={[median && r.rupiahPerTesCustomer
                      ? `${(r.rupiahPerTesCustomer / median).toFixed(2)}× median` : null,
                    "seluruh periode"].filter(Boolean).join(" · ")}
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
              {/* SATU GRAFIK TES PER ALAT (permintaan user 2026-08-19) — datanya
                  memang per aset di kso_asset_test_monthly. Diurutkan mengikuti daftar
                  alat di bawah (tes terbanyak dulu) supaya dua bagian ini sejalan. */}
              <div className="grid gap-4 lg:grid-cols-2">
                {detail.alat.map((a) => {
                  const semua = detail.trenAlat.filter((t) => t.assetId === a.assetId);
                  const per = new Map(semua.filter((t) => dalamJendela(t.periode))
                    .map((t) => [t.periode, t.jumlahTes]));
                  const seriAlat = deretBulan(dari, sampai).map((x) => ({
                    label: labelBulan(x),
                    tes: per.get(x) ?? null,
                    target: a.targetJumlahTes,
                  }));
                  const punyaRiwayatLama = semua.some(
                    (t) => !dalamJendela(t.periode) && t.jumlahTes !== null);
                  return (
                    <Grafik
                      key={a.assetId}
                      judul={a.namaAlat ?? a.snKey}
                      sub={[a.typeAlat, a.targetJumlahTes ? `target ${a.targetJumlahTes.toLocaleString("id-ID")}/bln` : "tanpa target"]
                        .filter(Boolean).join(" · ")}
                      ada={seriAlat.some((x) => x.tes !== null)}
                      kosong={punyaRiwayatLama
                        ? `Tidak ada laporan di ${dari.slice(0, 4)} — riwayatnya ada di tahun sebelumnya.`
                        : "Belum ada laporan tes untuk alat ini."}
                    >
                      <LineChart data={seriAlat} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                          interval="preserveStartEnd" minTickGap={14} />
                        <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10 }}
                          tickFormatter={(v) => angkaSumbu(Number(v))} />
                        {/* Dibandingkan CASE-INSENSITIVE ke awalan "target": recharts
                            mengirim `name` seri — yaitu "Target"/"Realisasi" berhuruf
                            besar — bukan dataKey-nya. Membandingkan ke "target" persis
                            membuat KEDUA baris tooltip berlabel "realisasi", dan itu
                            bukan sekadar salah tulis: pembaca melihat dua angka
                            realisasi berbeda di bulan yang sama. */}
                        <ChartTooltip content={<ChartTooltipContent
                          formatter={(v, n) => [Number(v).toLocaleString("id-ID") + " tes",
                            String(n).toLowerCase().startsWith("target") ? " target" : " realisasi"]} />} />
                        {/* Legenda WAJIB begitu ada dua seri — identitas tidak boleh
                            bergantung pada warna saja. */}
                        {a.targetJumlahTes ? <Legend verticalAlign="top" height={22}
                          formatter={(v) => <span className="text-muted-foreground text-[11px]">{v}</span>} /> : null}
                        <Line type="monotone" dataKey="tes" name="Realisasi" stroke="var(--color-tes)"
                          strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                        {/* Target hanya digambar kalau alat ini PUNYA target. Menggambar
                            garis nol untuk alat tanpa target akan terbaca sebagai
                            "targetnya nol", bukan "tidak ada target". */}
                        {a.targetJumlahTes ? (
                          <Line type="monotone" dataKey="target" name="Target" stroke="var(--color-target)"
                            strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} />
                        ) : null}
                      </LineChart>
                    </Grafik>
                  );
                })}
              </div>

              {/* Revenue TETAP satu grafik level faskes, TIDAK dipecah per alat. Faktur
                  Accurate terbit atas nama faskes; tak satu pun kolom menautkan rupiah ke
                  unit tertentu. Alasannya ditulis di layar, bukan cuma di kode — kalau
                  tidak, pembaca akan menganggap bagian ini belum selesai dikerjakan. */}
              <Grafik judul="Riwayat revenue netto (seluruh faskes)"
                sub={`tidak dapat dipecah per alat · ${skalaRev.satuan}`}
                ada={adaRev} kosong={adaRevLama
                  ? `Tidak ada faktur di ${dari.slice(0, 4)} — ada di tahun sebelumnya.`
                  : "Belum ada faktur."}>
                <LineChart data={seri} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                    interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 10 }}
                    tickFormatter={(v) => skalaRev.format(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent
                    formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), ""]} />} />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2}
                    dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                </LineChart>
              </Grafik>

              <p className="text-muted-foreground text-xs">
                Grafik dibatasi <strong>tahun {dari.slice(0, 4)}</strong>, sementara empat
                kartu di atas memakai <strong>seluruh periode</strong> — jadi menjumlahkan
                titik grafik tidak akan sama dengan kartu, dan itu bukan galat
                {adaTesLama || adaRevLama ? " (faskes ini punya riwayat sebelum itu)" : null}.
                Garis yang putus = bulan itu <strong>tidak ada laporan</strong>, bukan nol tes.
                <strong> Revenue tidak dipecah per alat</strong> karena faktur Accurate terbit
                atas nama faskes — tidak ada kolom yang menautkan rupiah ke unit tertentu, dan
                membaginya hanya akan menghasilkan angka yang terlihat presisi padahal karangan.
              </p>

              <div>
              {/* ── Reagen keluar ────────────────────────────────────────────────
                  "Rupiah masuk untuk reagen apa saja". Nilainya HASIL ALOKASI netto
                  faktur menurut porsi nilai baris (view kso_faskes_reagen_v, migrasi
                  120) — mekanisme sama dengan kartu Revenue di atas, jadi kedua angka
                  itu sepadan. Bukan penjumlahan nilai baris apa adanya. */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium">Reagen keluar ({detail.reagen.length})</span>
                  <span className="text-muted-foreground text-[11px]">
                    {dari.slice(0, 4)} · dalam skema {rp(totalDalam)}
                    {totalLuar > 0 ? <> · di luar skema {rp(totalLuar)}</> : null}
                  </span>
                </div>
                {detail.reagen.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Belum ada baris faktur di {dari.slice(0, 4)} untuk faskes ini.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="border-border border-b text-left">
                          <th className="py-1.5 pr-2 font-medium">Item</th>
                          <th className="py-1.5 pr-2 font-medium">Kategori</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                          <th className="py-1.5 pr-2 font-medium">Satuan</th>
                          <th className="py-1.5 text-right font-medium">Nilai netto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.reagen.map((r, i) => (
                          <tr key={`${r.itemId}-${r.kategori}-${r.unit}-${i}`}
                              className="border-border/60 border-b last:border-0">
                            <td className="py-1.5 pr-2">
                              <div className="font-medium">{r.itemNama ?? r.itemNo ?? "(tanpa nama)"}</div>
                              <div className="text-muted-foreground">
                                {/* jenisAlat NULL = item belum terpetakan, BUKAN "bukan
                                    reagen alat" — dibedakan supaya tak disalahbaca. */}
                                {[r.itemNo, r.jenisAlat ?? "jenis alat belum terpetakan"]
                                  .filter(Boolean).join(" · ")}
                              </div>
                            </td>
                            <td className="py-1.5 pr-2">
                              {r.dalamSkema
                                ? <span className="text-muted-foreground">{r.kategori}</span>
                                : <Tag warna="kuning" judul={`Kategori ${r.kategori} tidak dihitung sebagai revenue skema ini`}>{r.kategori}</Tag>}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{num(r.qty)}</td>
                            <td className="text-muted-foreground py-1.5 pr-2">{r.unit}</td>
                            <td className="py-1.5 text-right tabular-nums">{rp(r.nilaiNetto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-muted-foreground mt-1 text-xs">
                  Nilai = netto faktur <strong>teralokasi</strong> menurut porsi nilai baris,
                  bukan penjumlahan nilai baris apa adanya. Subtotal{" "}
                  <strong>dalam skema</strong> memakai kategori dan porsi KSO yang sama dengan
                  kartu <strong>Revenue netto</strong> di atas, jadi dua angka itu sepadan.
                  {reagenLuar > 0 ? (
                    <> {reagenLuar} baris berkategori <strong>di luar skema ini</strong> ikut
                    ditampilkan (ditandai kuning) dan <strong>tidak</strong> masuk angka Revenue —
                    ia sengaja tidak dijumlahkan ke dalamnya.</>
                  ) : null}
                  {" "}Satu item bisa muncul dua kali bila ditagih dalam satuan berbeda —
                  qty lintas satuan tidak dijumlahkan.
                </p>
              </div>

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

function Grafik({ judul, sub, ada, kosong, children }: {
  judul: string; sub?: string; ada: boolean; kosong: string;
  children: React.ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <div>
      <div className="text-xs font-medium">{judul}</div>
      {sub ? <div className="text-muted-foreground mb-1 text-[11px]">{sub}</div> : <div className="mb-1" />}
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
