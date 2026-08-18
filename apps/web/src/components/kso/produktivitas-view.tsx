"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface KsoProduktivitasRow {
  assetId: number; snKey: string; customerRaw: string; accountId: number | null;
  faskes: string | null; kota: string | null; typeAlat: string | null; namaAlat: string | null;
  skema: string; targetJumlahTes: number | null; totalTes: number | null;
  rataTesBulanan: number | null; capaianTarget: number | null;
  revenueNettoCustomer: number | null; alatSeskemaDiCustomer: number | null;
  totalTesCustomerSeskema: number | null; rupiahPerTesCustomer: number | null;
  basisTesMemadai: boolean; porsiKso: number | null; revenueTumpangTindih: boolean;
  tesSheetPeriodeBanding: number | null; tesDitagihkanAccurate: number | null;
  rasioTagihLapor: number | null; bulanTertagihAccurate: number | null;
  tagihPolaDatar: boolean; statusPenagihan: string | null;
}
export interface KsoProduktivitas {
  rows: KsoProduktivitasRow[];
  ringkasan: { aset: number; faskes: number; layakDiperingkat: number; medianRpPerTes: Record<string, number | null> };
}

// Satu baris = satu FASKES x SKEMA, bukan satu aset.
//
// KENAPA: view-nya per aset, sementara Rp/tes, revenue, dan seluruh penanda ada di level
// CUSTOMER — nilainya identik untuk semua alat seskema di faskes yang sama. Ditampilkan
// apa adanya, tabel ini jadi peringkat yang menyesatkan: pada data prod 2026-08-18,
// 201 baris PER_TEST hanya mewakili 68 faskes (3,0 baris/faskes), dan
// MUSLIMAT RS PONOROGO menempati 18 baris BERTURUT-TURUT dengan angka sama persis —
// mendorong faskes lain keluar halaman dan membuat "201 baris" terbaca seperti 201 faskes.
//
// Nama alatnya tidak hilang: dikumpulkan jadi daftar di baris yang sama.
interface FaskesRow {
  key: string;
  faskes: string;
  kota: string | null;
  alatList: string[];
  r: KsoProduktivitasRow;   // nilai level-customer; sama untuk semua alat di grup ini
}

function kelompokkan(rows: KsoProduktivitasRow[]): FaskesRow[] {
  const map = new Map<string, FaskesRow>();
  for (const r of rows) {
    // account_id null (mis. skema UNKNOWN belum terpetakan) → jatuh ke nama sheet,
    // supaya baris tanpa account tidak semuanya menggumpal jadi satu grup.
    const key = `${r.skema}::${r.accountId ?? `raw:${r.customerRaw}`}`;
    const g = map.get(key);
    if (g) { if (r.namaAlat) g.alatList.push(r.namaAlat); continue; }
    map.set(key, {
      key,
      faskes: r.faskes ?? r.customerRaw,
      kota: r.kota,
      alatList: r.namaAlat ? [r.namaAlat] : [],
      r,
    });
  }
  return [...map.values()];
}

const rp = (n: number | null) => (n === null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("id-ID"));

// Rp ringkas untuk sumbu & label batang — "Rp 1.234.567.890" merusak lebar grafik.
const rpSingkat = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 0 })} jt`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return n.toLocaleString("id-ID");
};

const SEMUA = "__semua__";

// Penanda yang bisa dipakai menyaring. Nilainya diturunkan dari baris, bukan disimpan
// sebagai kolom, supaya definisinya cuma hidup di satu tempat (dipakai chip DAN filter).
const PENANDA = [
  { id: "penyebut_tipis",   label: "Penyebut tipis",   uji: (r: KsoProduktivitasRow) => !r.basisTesMemadai },
  { id: "minimum_kontrak",  label: "Minimum kontrak",  uji: (r: KsoProduktivitasRow) => r.tagihPolaDatar },
  { id: "skema_ganda",      label: "Skema ganda",      uji: (r: KsoProduktivitasRow) => r.revenueTumpangTindih },
  { id: "tanpa_faktur",     label: "Tanpa faktur",     uji: (r: KsoProduktivitasRow) => r.statusPenagihan === "tanpa_faktur" },
  { id: "rasio_timpang",    label: "Tagih/lapor timpang", uji: (r: KsoProduktivitasRow) => r.rasioTagihLapor !== null && Math.abs(r.rasioTagihLapor - 1) > 0.25 },
] as const;

export function KsoProduktivitasView({ data }: { data: KsoProduktivitas }) {
  const [skema, setSkema] = useState("PER_TEST");
  // Default HANYA yang layak diperingkat. Membuka halaman langsung pada daftar
  // penuh berarti baris teratasnya alat 1-4 tes dengan Rp/tes ratusan juta —
  // pembalikan makna yang justru ditutup migrasi 100.
  const [hanyaLayak, setHanyaLayak] = useState(true);
  const [kota, setKota] = useState(SEMUA);
  const [alat, setAlat] = useState(SEMUA);
  const [penanda, setPenanda] = useState(SEMUA);

  const median = data.ringkasan.medianRpPerTes[skema] ?? null;

  // Dasar = skema + ambang layak. Opsi kota/alat diturunkan dari SINI, bukan dari
  // hasil akhir — kalau diturunkan dari hasil yang sudah tersaring, memilih satu kota
  // akan mengosongkan daftar kota itu sendiri dan filternya mengunci diri.
  const dasar = useMemo(
    () => kelompokkan(data.rows.filter((r) => r.skema === skema && (!hanyaLayak || r.basisTesMemadai))),
    [data.rows, skema, hanyaLayak],
  );

  const opsiKota = useMemo(
    () => [...new Set(dasar.map((g) => g.kota).filter((k): k is string => !!k))].sort((a, b) => a.localeCompare(b, "id")),
    [dasar],
  );
  const opsiAlat = useMemo(
    () => [...new Set(dasar.flatMap((g) => g.alatList))].sort((a, b) => a.localeCompare(b, "id")),
    [dasar],
  );

  const rows = useMemo(() => {
    const p = PENANDA.find((x) => x.id === penanda);
    return dasar.filter((g) =>
      (kota === SEMUA || g.kota === kota) &&
      (alat === SEMUA || g.alatList.includes(alat)) &&
      (!p || p.uji(g.r)));
  }, [dasar, kota, alat, penanda]);

  // ── Ringkasan atas ──────────────────────────────────────────────
  // Menjumlahkan revenue aman DI DALAM satu skema: setelah dikelompokkan, satu faskes
  // = satu baris, jadi tidak ada penggandaan seperti pada tabel per-aset. Lintas skema
  // TIDAK dijumlahkan di mana pun — porsi KSO milik faskes berskema ganda akan
  // terhitung dua kali (itulah penanda "skema ganda").
  const total = useMemo(() => {
    let revenue = 0, tes = 0, alatCount = 0, tertanda = 0;
    for (const g of rows) {
      revenue += g.r.revenueNettoCustomer ?? 0;
      tes += g.r.totalTesCustomerSeskema ?? 0;
      alatCount += g.r.alatSeskemaDiCustomer ?? g.alatList.length;
      if (PENANDA.some((p) => p.uji(g.r))) tertanda++;
    }
    return { revenue, tes, alatCount, tertanda };
  }, [rows]);

  // ── Grafik 1: 10 faskes revenue terbesar (magnitude → batang) ──
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

  // ── Grafik 2: sebaran Rp/tes relatif median ────────────────────
  // Median dipilih sebagai patokan, bukan rata-rata: sebaran Rp/tes sangat miring
  // (segelintir faskes puluhan kali lipat), jadi rata-rata akan tertarik outlier dan
  // hampir semua faskes tampak "di bawah rata-rata".
  const BAND = [
    { id: "<0,5×",  uji: (x: number) => x < 0.5 },
    { id: "0,5–1×", uji: (x: number) => x >= 0.5 && x < 1 },
    { id: "1–2×",   uji: (x: number) => x >= 1 && x < 2 },
    { id: "2–5×",   uji: (x: number) => x >= 2 && x < 5 },
    { id: "≥5×",    uji: (x: number) => x >= 5 },
  ];
  const sebaran = useMemo(() => {
    if (!median) return [];
    const nilai = rows.map((g) => g.r.rupiahPerTesCustomer).filter((v): v is number => v !== null && v > 0)
      .map((v) => v / median);
    return BAND.map((b) => ({ band: b.id, jumlah: nilai.filter(b.uji).length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, median]);

  const chartConfig = {
    revenue: { label: "Revenue netto", color: "var(--chart-2)" },
    jumlah: { label: "Faskes", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const cols: DataColumn<FaskesRow>[] = [
    { id: "faskes", header: "Faskes", sortable: true,
      accessor: (g) => g.faskes,
      cell: (g) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{g.faskes}</div>
          <div className="text-muted-foreground truncate text-xs" title={g.alatList.join(", ")}>
            {[g.alatList.slice(0, 3).join(", ") + (g.alatList.length > 3 ? ` +${g.alatList.length - 3}` : ""),
              g.kota].filter(Boolean).join(" · ")}
          </div>
        </div>
      ) },
    { id: "tes", header: "Tes (customer)", align: "right", sortable: true,
      accessor: (g) => g.r.totalTesCustomerSeskema ?? 0,
      cell: (g) => num(g.r.totalTesCustomerSeskema) },
    { id: "alat", header: "Alat", align: "center", sortable: true,
      accessor: (g) => g.r.alatSeskemaDiCustomer ?? g.alatList.length,
      cell: (g) => g.r.alatSeskemaDiCustomer ?? g.alatList.length },
    { id: "revenue", header: "Revenue netto", align: "right", sortable: true,
      accessor: (g) => g.r.revenueNettoCustomer ?? 0,
      cell: (g) => rp(g.r.revenueNettoCustomer) },
    { id: "rpt", header: "Rp / tes", align: "right", sortable: true,
      accessor: (g) => g.r.rupiahPerTesCustomer ?? 0,
      cell: (g) => (
        <div>
          <div className={cn("font-medium", !g.r.basisTesMemadai && "text-muted-foreground")}>
            {rp(g.r.rupiahPerTesCustomer)}
          </div>
          {median && g.r.rupiahPerTesCustomer ? (
            <div className="text-muted-foreground text-xs">
              {(g.r.rupiahPerTesCustomer / median).toFixed(2)}× median
            </div>
          ) : null}
        </div>
      ) },
    { id: "tanda", header: "Penanda",
      cell: (g) => (
        <div className="flex flex-wrap gap-1">
          {!g.r.basisTesMemadai ? <Tag warna="merah" judul="Penyebut < 100 tes/thn — jangan dipakai memeringkat">penyebut tipis</Tag> : null}
          {g.r.tagihPolaDatar ? <Tag warna="kuning" judul="Qty Accurate datar tiap bulan = minimum kontrak, bukan hitungan tes">minimum kontrak</Tag> : null}
          {g.r.revenueTumpangTindih ? <Tag warna="biru" judul={`Faskes berskema ganda; porsi KSO ${g.r.porsiKso ?? "—"}`}>skema ganda</Tag> : null}
          {g.r.statusPenagihan === "tanpa_faktur" ? <Tag warna="merah" judul="Tidak ada faktur atas nama faskes ini">tanpa faktur</Tag> : null}
        </div>
      ) },
    { id: "rasio", header: "Tagih / lapor", align: "right", sortable: true,
      accessor: (g) => g.r.rasioTagihLapor ?? -1,
      cell: (g) => (g.r.rasioTagihLapor === null
        ? <span className="text-muted-foreground text-xs">n/a</span>
        : <span className={cn(Math.abs(g.r.rasioTagihLapor - 1) > 0.25 && "text-amber-600 font-medium")}>
            {g.r.rasioTagihLapor.toFixed(2)}
          </span>) },
  ];

  const adaFilter = kota !== SEMUA || alat !== SEMUA || penanda !== SEMUA;

  return (
    <div className="space-y-4">
      {/* ── Filter: satu baris di atas grafik ───────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          {/* Select eksplisit, BUKAN FilterSelect: komponen itu selalu menyisipkan
              opsi kosong "Semua", sedangkan "semua skema" tidak bermakna di sini —
              median PER_TEST dan BELI_REAGEN berbeda beberapa kali lipat, jadi
              menggabungkannya dalam satu peringkat menyesatkan. */}
          <Pilih label="Skema" value={skema} onChange={setSkema}>
            {/* Hanya DUA pilihan. Aset berskema UNKNOWN tidak pernah muncul di sini:
                kso_asset_produktivitas_v mem-JOIN kategori_skema yang cuma mengenal
                PER_TEST & BELI_REAGEN, jadi aset tanpa skema (STATUS kosong atau tak
                dikenali di Populasi KSO) tersaring di lapisan view. Opsi "Tanpa skema"
                akan selamanya kosong — menyajikannya membuat orang mengira datanya hilang,
                padahal masalahnya di sheet. Disebut di catatan bawah tabel. */}
            <option value="PER_TEST">PER_TEST (KSO Tes)</option>
            <option value="BELI_REAGEN">BELI_REAGEN (KSO Reagen)</option>
          </Pilih>

          <Pilih label="Kota" value={kota} onChange={setKota}>
            <option value={SEMUA}>Semua kota ({opsiKota.length})</option>
            {opsiKota.map((k) => <option key={k} value={k}>{k}</option>)}
          </Pilih>

          <Pilih label="Alat" value={alat} onChange={setAlat}>
            <option value={SEMUA}>Semua alat ({opsiAlat.length})</option>
            {opsiAlat.map((a) => <option key={a} value={a}>{a}</option>)}
          </Pilih>

          <Pilih label="Penanda" value={penanda} onChange={setPenanda}>
            <option value={SEMUA}>Semua</option>
            {PENANDA.map((p) => (
              <option key={p.id} value={p.id}>{p.label} ({dasar.filter((g) => p.uji(g.r)).length})</option>
            ))}
          </Pilih>

          <label className="flex cursor-pointer items-center gap-2 pb-1 text-sm">
            <input type="checkbox" checked={hanyaLayak} onChange={(e) => setHanyaLayak(e.target.checked)} />
            Hanya yang layak diperingkat
          </label>

          {adaFilter ? (
            <button
              type="button"
              onClick={() => { setKota(SEMUA); setAlat(SEMUA); setPenanda(SEMUA); }}
              className="text-muted-foreground hover:text-foreground pb-1 text-xs underline underline-offset-2"
            >
              Reset filter
            </button>
          ) : null}

          <div className="text-muted-foreground ml-auto pb-1 text-sm">
            {rows.length} faskes{median ? <> · median <span className="font-medium">{rp(median)}</span>/tes</> : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Ringkasan angka ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistik label="Faskes" nilai={rows.length.toLocaleString("id-ID")}
          catatan={`${total.alatCount.toLocaleString("id-ID")} alat`} />
        <Statistik label="Revenue netto" nilai={"Rp " + rpSingkat(total.revenue)}
          catatan="tanpa PPN, skema ini saja" />
        <Statistik label="Total tes" nilai={total.tes.toLocaleString("id-ID")}
          catatan="realisasi di alat" />
        <Statistik label="Perlu diperiksa" nilai={total.tertanda.toLocaleString("id-ID")}
          catatan="faskes berpenanda"
          tekan={total.tertanda > 0} />
      </div>

      {/* ── Grafik ──────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">10 faskes revenue terbesar</CardTitle>
          </CardHeader>
          <CardContent>
            {top10.length ? (
              <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
                <BarChart data={top10} layout="vertical" margin={{ left: 4, right: 56, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="revenue" hide />
                  <YAxis type="category" dataKey="nama" width={150} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={<ChartTooltipContent
                      labelFormatter={(_, p) => String(p?.[0]?.payload?.penuh ?? "")}
                      formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), " revenue netto"]} />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} barSize={16}>
                    <LabelList dataKey="revenue" position="right" offset={8}
                      className="fill-muted-foreground" fontSize={11}
                      formatter={(v) => (typeof v === "number" ? rpSingkat(v) : "")} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : <Kosong /> }
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sebaran Rp/tes terhadap median</CardTitle>
          </CardHeader>
          <CardContent>
            {sebaran.length ? (
              <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
                <BarChart data={sebaran} margin={{ left: 4, right: 4, top: 20, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="band" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis hide />
                  <ChartTooltip
                    content={<ChartTooltipContent
                      labelFormatter={(l) => `${l} median`}
                      formatter={(v) => [`${v} faskes`, ""]} />} />
                  <Bar dataKey="jumlah" fill="var(--color-jumlah)" radius={[4, 4, 0, 0]} maxBarSize={56}>
                    <LabelList dataKey="jumlah" position="top" offset={6}
                      className="fill-muted-foreground" fontSize={11} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : <Kosong pesan="Median belum tersedia untuk skema ini." /> }
            <p className="text-muted-foreground mt-1 text-xs">
              Patokannya <strong>median</strong>, bukan rata-rata — sebaran Rp/tes sangat miring,
              dan rata-rata akan tertarik segelintir faskes yang puluhan kali lipat.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex items-start gap-2 py-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground">
            <strong>Rp/tes dihitung di level customer</strong>, bukan per alat — revenue milik faskes,
            dan kolom “Alat” menunjukkan berapa alat seskema yang membagi angka itu.
            Kedua skema <strong>tidak sebanding</strong> satu sama lain (median berbeda beberapa kali lipat),
            jadi peringkatnya terpisah dan angkanya tidak pernah dijumlahkan lintas skema.
          </p>
        </CardContent>
      </Card>

      {!hanyaLayak ? (
        <Card className="border-amber-300">
          <CardContent className="flex items-start gap-2 py-3 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              Filter “layak diperingkat” dimatikan. Baris berpenanda <em>penyebut tipis</em> punya
              kurang dari 100 tes setahun — Rp/tes-nya didominasi derau, dan mengurutkannya menurun
              menaikkan alat yang paling <em>tidak</em> terpakai ke puncak. Grafik di atas ikut
              terpengaruh.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabel dibungkus Card supaya duduk di permukaan putih, tidak langsung di
          latar halaman — sama seperti panel lain di dashboard. */}
      <Card>
        <CardContent>
          <DataTable
            columns={cols}
            data={rows}
            getKey={(g) => g.key}
            searchPlaceholder="Cari faskes, alat, kota…"
            pageSize={25}
            initialSort={{ id: "rpt", dir: "desc" }}
            empty="Tidak ada faskes pada filter ini."
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Aset yang skemanya belum ditentukan tidak muncul di halaman ini — kolom STATUS-nya
        kosong atau tidak dikenali di sheet <em>Populasi KSO</em>, sehingga tersaring di
        lapisan view. Perbaikannya di sheet, bukan di sini.
      </p>
    </div>
  );
}

function Pilih({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs whitespace-nowrap">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-card text-foreground h-8 max-w-[190px] rounded-md border px-2 text-xs"
      >
        {children}
      </select>
    </label>
  );
}

function Statistik({ label, nilai, catatan, tekan }: {
  label: string; nilai: string; catatan?: string; tekan?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className={cn("text-2xl font-semibold tabular-nums", tekan && "text-amber-600")}>{nilai}</div>
        {catatan ? <div className="text-muted-foreground text-xs">{catatan}</div> : null}
      </CardContent>
    </Card>
  );
}

function Kosong({ pesan = "Tidak ada data pada filter ini." }: { pesan?: string }) {
  return <div className="text-muted-foreground flex h-[320px] items-center justify-center text-xs">{pesan}</div>;
}

function Tag({ children, warna, judul }: { children: React.ReactNode; warna: "merah" | "kuning" | "biru"; judul: string }) {
  const c = { merah: "bg-red-50 text-red-700 border-red-200",
              kuning: "bg-amber-50 text-amber-700 border-amber-200",
              biru: "bg-blue-50 text-blue-700 border-blue-200" }[warna];
  return <span title={judul} className={cn("rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap", c)}>{children}</span>;
}
