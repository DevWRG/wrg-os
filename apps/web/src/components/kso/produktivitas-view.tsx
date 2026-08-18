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

const rp = (n: number | null) => (n === null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("id-ID"));

export function KsoProduktivitasView({ data }: { data: KsoProduktivitas }) {
  const [skema, setSkema] = useState("PER_TEST");
  // Default HANYA yang layak diperingkat. Membuka halaman langsung pada daftar
  // penuh berarti baris teratasnya alat 1-4 tes dengan Rp/tes ratusan juta —
  // pembalikan makna yang justru ditutup migrasi 100.
  const [hanyaLayak, setHanyaLayak] = useState(true);

  const rows = useMemo(
    () => data.rows.filter((r) => r.skema === skema && (!hanyaLayak || r.basisTesMemadai)),
    [data.rows, skema, hanyaLayak],
  );
  const median = data.ringkasan.medianRpPerTes[skema] ?? null;

  const cols: DataColumn<KsoProduktivitasRow>[] = [
    { id: "faskes", header: "Faskes", sortable: true,
      accessor: (r) => r.faskes ?? r.customerRaw,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.faskes ?? r.customerRaw}</div>
          <div className="text-muted-foreground truncate text-xs">
            {[r.namaAlat, r.kota].filter(Boolean).join(" · ")}
          </div>
        </div>
      ) },
    { id: "tes", header: "Tes (customer)", align: "right", sortable: true,
      accessor: (r) => r.totalTesCustomerSeskema ?? 0,
      cell: (r) => num(r.totalTesCustomerSeskema) },
    { id: "alat", header: "Alat berbagi", align: "center", sortable: true,
      accessor: (r) => r.alatSeskemaDiCustomer ?? 0,
      cell: (r) => r.alatSeskemaDiCustomer ?? "—" },
    { id: "revenue", header: "Revenue netto", align: "right", sortable: true,
      accessor: (r) => r.revenueNettoCustomer ?? 0,
      cell: (r) => rp(r.revenueNettoCustomer) },
    { id: "rpt", header: "Rp / tes", align: "right", sortable: true,
      accessor: (r) => r.rupiahPerTesCustomer ?? 0,
      cell: (r) => (
        <div>
          <div className={cn("font-medium", !r.basisTesMemadai && "text-muted-foreground")}>
            {rp(r.rupiahPerTesCustomer)}
          </div>
          {median && r.rupiahPerTesCustomer ? (
            <div className="text-muted-foreground text-xs">
              {(r.rupiahPerTesCustomer / median).toFixed(2)}× median
            </div>
          ) : null}
        </div>
      ) },
    { id: "tanda", header: "Penanda",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {!r.basisTesMemadai ? <Tag warna="merah" judul="Penyebut < 100 tes/thn — jangan dipakai memeringkat">penyebut tipis</Tag> : null}
          {r.tagihPolaDatar ? <Tag warna="kuning" judul="Qty Accurate datar tiap bulan = minimum kontrak, bukan hitungan tes">minimum kontrak</Tag> : null}
          {r.revenueTumpangTindih ? <Tag warna="biru" judul={`Faskes berskema ganda; porsi KSO ${r.porsiKso ?? "—"}`}>skema ganda</Tag> : null}
          {r.statusPenagihan === "tanpa_faktur" ? <Tag warna="merah" judul="Tidak ada faktur atas nama faskes ini">tanpa faktur</Tag> : null}
        </div>
      ) },
    { id: "rasio", header: "Tagih / lapor", align: "right", sortable: true,
      accessor: (r) => r.rasioTagihLapor ?? -1,
      cell: (r) => (r.rasioTagihLapor === null
        ? <span className="text-muted-foreground text-xs">n/a</span>
        : <span className={cn(Math.abs(r.rasioTagihLapor - 1) > 0.25 && "text-amber-600 font-medium")}>
            {r.rasioTagihLapor.toFixed(2)}
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
              <option value="PER_TEST">PER_TEST (KSO Tes)</option>
              <option value="BELI_REAGEN">BELI_REAGEN (KSO Reagen)</option>
              <option value="UNKNOWN">Tanpa skema</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={hanyaLayak} onChange={(e) => setHanyaLayak(e.target.checked)} />
            Hanya yang layak diperingkat
          </label>
          <div className="text-muted-foreground ml-auto text-sm">
            {rows.length} baris{median ? <> · median <span className="font-medium">{rp(median)}</span>/tes</> : null}
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

      <DataTable
        columns={cols}
        data={rows}
        getKey={(r) => String(r.assetId)}
        searchPlaceholder="Cari faskes, alat, kota…"
        pageSize={25}
        initialSort={{ id: "rpt", dir: "desc" }}
        empty="Tidak ada aset pada filter ini."
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
