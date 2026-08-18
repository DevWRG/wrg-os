"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
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

export function KsoProduktivitasView({ data }: { data: KsoProduktivitas }) {
  const [skema, setSkema] = useState("PER_TEST");
  // Default HANYA yang layak diperingkat. Membuka halaman langsung pada daftar
  // penuh berarti baris teratasnya alat 1-4 tes dengan Rp/tes ratusan juta —
  // pembalikan makna yang justru ditutup migrasi 100.
  const [hanyaLayak, setHanyaLayak] = useState(true);

  const rows = useMemo(
    () => kelompokkan(data.rows.filter((r) => r.skema === skema && (!hanyaLayak || r.basisTesMemadai))),
    [data.rows, skema, hanyaLayak],
  );
  const median = data.ringkasan.medianRpPerTes[skema] ?? null;

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

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          {/* Select eksplisit, BUKAN FilterSelect: komponen itu selalu menyisipkan
              opsi kosong "Semua", sedangkan "semua skema" tidak bermakna di sini —
              median PER_TEST dan BELI_REAGEN berbeda beberapa kali lipat, jadi
              menggabungkannya dalam satu peringkat menyesatkan. */}
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="whitespace-nowrap">Skema</span>
            <select
              value={skema}
              onChange={(e) => setSkema(e.target.value)}
              className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs"
            >
              {/* Hanya DUA pilihan. Aset berskema UNKNOWN tidak pernah muncul di sini:
                  kso_asset_produktivitas_v mem-JOIN kategori_skema yang cuma mengenal
                  PER_TEST & BELI_REAGEN, jadi 22 aset tanpa skema (STATUS kosong atau tak
                  dikenali di Populasi KSO) tersaring di lapisan view. Opsi "Tanpa skema"
                  akan selamanya kosong — menyajikannya membuat orang mengira datanya hilang,
                  padahal masalahnya di sheet. Jumlahnya disebut di catatan bawah tabel. */}
              <option value="PER_TEST">PER_TEST (KSO Tes)</option>
              <option value="BELI_REAGEN">BELI_REAGEN (KSO Reagen)</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={hanyaLayak} onChange={(e) => setHanyaLayak(e.target.checked)} />
            Hanya yang layak diperingkat
          </label>
          <div className="text-muted-foreground ml-auto text-sm">
            {rows.length} faskes{median ? <> · median <span className="font-medium">{rp(median)}</span>/tes</> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-2 py-3 text-xs">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <strong>Rp/tes dihitung di level customer</strong>, bukan per alat — revenue milik faskes,
            dan kolom “Alat berbagi” menunjukkan berapa alat seskema yang membagi angka itu.
            Kedua skema <strong>tidak sebanding</strong> satu sama lain (median berbeda beberapa kali lipat),
            jadi peringkatnya terpisah.
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
              menaikkan alat yang paling <em>tidak</em> terpakai ke puncak.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Aset yang skemanya belum ditentukan tidak muncul di halaman ini — kolom STATUS-nya
        kosong atau tidak dikenali di sheet <em>Populasi KSO</em>, sehingga tersaring di
        lapisan view. Perbaikannya di sheet, bukan di sini.
      </p>

      <DataTable
        columns={cols}
        data={rows}
        getKey={(g) => g.key}
        searchPlaceholder="Cari faskes, alat, kota…"
        pageSize={25}
        initialSort={{ id: "rpt", dir: "desc" }}
        empty="Tidak ada faskes pada filter ini."
      />
    </div>
  );
}

function Tag({ children, warna, judul }: { children: React.ReactNode; warna: "merah" | "kuning" | "biru"; judul: string }) {
  const c = { merah: "bg-red-50 text-red-700 border-red-200",
              kuning: "bg-amber-50 text-amber-700 border-amber-200",
              biru: "bg-blue-50 text-blue-700 border-blue-200" }[warna];
  return <span title={judul} className={cn("rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap", c)}>{children}</span>;
}
