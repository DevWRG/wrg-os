"use client";

// Potongan yang dipakai BERSAMA oleh dua muka Produktivitas KSO:
//   /kso-produktivitas            → tabel per faskes
//   /kso-produktivitas/ringkasan  → kartu angka + grafik
//
// KENAPA SATU BERKAS, BUKAN DISALIN: filternya identik dan hasilnya harus identik.
// Kalau dua halaman menyaring dengan kode berbeda, angka di Ringkasan bisa tidak cocok
// dengan isi tabel dan tidak ada yang akan tahu mana yang benar — jenis kesalahan yang
// tidak memunculkan error sama sekali.

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

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

export interface KsoTrenRow {
  skema: string; periode: string;
  jumlahTes: number | null;      // NULL = bulan itu tidak ada laporan, BUKAN nol tes
  alatLapor: number | null; faskesLapor: number | null; revenueNetto: number | null;
}

export interface KsoProduktivitas {
  rows: KsoProduktivitasRow[];
  tren: KsoTrenRow[];
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
export interface FaskesRow {
  key: string;
  faskes: string;
  kota: string | null;
  alatList: string[];
  r: KsoProduktivitasRow;   // nilai level-customer; sama untuk semua alat di grup ini
}

export function kelompokkan(rows: KsoProduktivitasRow[]): FaskesRow[] {
  const map = new Map<string, FaskesRow>();
  for (const r of rows) {
    // account_id null (mis. skema UNKNOWN belum terpetakan) → jatuh ke nama sheet,
    // supaya baris tanpa account tidak semuanya menggumpal jadi satu grup.
    const key = `${r.skema}::${r.accountId ?? `raw:${r.customerRaw}`}`;
    const g = map.get(key);
    if (g) { if (r.namaAlat) g.alatList.push(r.namaAlat); continue; }
    map.set(key, {
      key, faskes: r.faskes ?? r.customerRaw, kota: r.kota,
      alatList: r.namaAlat ? [r.namaAlat] : [], r,
    });
  }
  return [...map.values()];
}

export const rp = (n: number | null) => (n === null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
export const num = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("id-ID"));

// Rp ringkas untuk sumbu & label batang — "Rp 1.234.567.890" merusak lebar grafik.
export const rpSingkat = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 0 })} jt`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return n.toLocaleString("id-ID");
};

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// 'YYYY-MM-DD' dipotong manual, TIDAK lewat new Date(): konstruktor Date menafsirkan
// string itu sebagai UTC lalu ditampilkan di zona lokal, sehingga 2026-01-01 bisa
// terbaca "Des 2025" di WIB — seluruh grafik meleset satu bulan.
export const labelBulan = (periode: string) => {
  const [y, m] = periode.split("-");
  return `${BULAN[Number(m) - 1] ?? m} ${y.slice(2)}`;
};

export const SEMUA = "__semua__";

// Penanda yang bisa dipakai menyaring. Diturunkan dari baris, bukan disimpan sebagai
// kolom, supaya definisinya cuma hidup di satu tempat (dipakai chip DAN filter).
export const PENANDA = [
  { id: "penyebut_tipis",   label: "Penyebut tipis",      uji: (r: KsoProduktivitasRow) => !r.basisTesMemadai },
  { id: "minimum_kontrak",  label: "Minimum kontrak",     uji: (r: KsoProduktivitasRow) => r.tagihPolaDatar },
  { id: "skema_ganda",      label: "Skema ganda",         uji: (r: KsoProduktivitasRow) => r.revenueTumpangTindih },
  { id: "tanpa_faktur",     label: "Tanpa faktur",        uji: (r: KsoProduktivitasRow) => r.statusPenagihan === "tanpa_faktur" },
  { id: "rasio_timpang",    label: "Tagih/lapor timpang", uji: (r: KsoProduktivitasRow) => r.rasioTagihLapor !== null && Math.abs(r.rasioTagihLapor - 1) > 0.25 },
] as const;

export interface FilterKso {
  skema: string; setSkema: (v: string) => void;
  hanyaLayak: boolean; setHanyaLayak: (v: boolean) => void;
  kota: string; setKota: (v: string) => void;
  alat: string; setAlat: (v: string) => void;
  penanda: string; setPenanda: (v: string) => void;
  dasar: FaskesRow[]; rows: FaskesRow[];
  opsiKota: string[]; opsiAlat: string[];
  median: number | null; adaFilter: boolean; reset: () => void;
}

export function useFilterKso(data: KsoProduktivitas): FilterKso {
  const [skema, setSkema] = useState("PER_TEST");
  // Default HANYA yang layak diperingkat. Membuka halaman langsung pada daftar penuh
  // berarti baris teratasnya alat 1-4 tes dengan Rp/tes ratusan juta — pembalikan makna
  // yang justru ditutup migrasi 100.
  const [hanyaLayak, setHanyaLayak] = useState(true);
  const [kota, setKota] = useState(SEMUA);
  const [alat, setAlat] = useState(SEMUA);
  const [penanda, setPenanda] = useState(SEMUA);

  // Dasar = skema + ambang layak. Opsi kota/alat diturunkan dari SINI, bukan dari hasil
  // akhir — kalau dari hasil yang sudah tersaring, memilih satu kota akan mengosongkan
  // daftar kota itu sendiri dan filternya mengunci diri.
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

  return {
    skema, setSkema, hanyaLayak, setHanyaLayak, kota, setKota, alat, setAlat, penanda, setPenanda,
    dasar, rows, opsiKota, opsiAlat,
    median: data.ringkasan.medianRpPerTes[skema] ?? null,
    adaFilter: kota !== SEMUA || alat !== SEMUA || penanda !== SEMUA,
    reset: () => { setKota(SEMUA); setAlat(SEMUA); setPenanda(SEMUA); },
  };
}

export function FilterBarKso({ f, kanan }: { f: FilterKso; kanan?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        {/* Select eksplisit, BUKAN FilterSelect: komponen itu selalu menyisipkan opsi
            kosong "Semua", sedangkan "semua skema" tidak bermakna di sini — median
            PER_TEST dan BELI_REAGEN berbeda beberapa kali lipat, jadi menggabungkannya
            dalam satu peringkat menyesatkan. */}
        <Pilih label="Skema" value={f.skema} onChange={f.setSkema}>
          {/* Hanya DUA pilihan. Aset berskema UNKNOWN tidak pernah muncul di sini:
              kso_asset_produktivitas_v mem-JOIN kategori_skema yang cuma mengenal
              PER_TEST & BELI_REAGEN, jadi aset tanpa skema tersaring di lapisan view.
              Opsi "Tanpa skema" akan selamanya kosong — menyajikannya membuat orang
              mengira datanya hilang, padahal masalahnya di sheet. */}
          <option value="PER_TEST">PER_TEST (KSO Tes)</option>
          <option value="BELI_REAGEN">BELI_REAGEN (KSO Reagen)</option>
        </Pilih>

        <Pilih label="Kota" value={f.kota} onChange={f.setKota}>
          <option value={SEMUA}>Semua kota ({f.opsiKota.length})</option>
          {f.opsiKota.map((k) => <option key={k} value={k}>{k}</option>)}
        </Pilih>

        <Pilih label="Alat" value={f.alat} onChange={f.setAlat}>
          <option value={SEMUA}>Semua alat ({f.opsiAlat.length})</option>
          {f.opsiAlat.map((a) => <option key={a} value={a}>{a}</option>)}
        </Pilih>

        <Pilih label="Penanda" value={f.penanda} onChange={f.setPenanda}>
          <option value={SEMUA}>Semua</option>
          {PENANDA.map((p) => (
            <option key={p.id} value={p.id}>{p.label} ({f.dasar.filter((g) => p.uji(g.r)).length})</option>
          ))}
        </Pilih>

        <label className="flex cursor-pointer items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={f.hanyaLayak} onChange={(e) => f.setHanyaLayak(e.target.checked)} />
          Hanya yang layak diperingkat
        </label>

        {f.adaFilter ? (
          <button type="button" onClick={f.reset}
            className="text-muted-foreground hover:text-foreground pb-1 text-xs underline underline-offset-2">
            Reset filter
          </button>
        ) : null}

        <div className="text-muted-foreground ml-auto pb-1 text-sm">
          {kanan ?? <>{f.rows.length} faskes{f.median ? <> · median <span className="font-medium">{rp(f.median)}</span>/tes</> : null}</>}
        </div>
      </CardContent>
    </Card>
  );
}

export function Pilih({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs whitespace-nowrap">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border-input bg-card text-foreground h-8 max-w-[190px] rounded-md border px-2 text-xs">
        {children}
      </select>
    </label>
  );
}

export function Statistik({ label, nilai, catatan, tekan }: {
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

export function Tag({ children, warna, judul }: {
  children: React.ReactNode; warna: "merah" | "kuning" | "biru"; judul: string;
}) {
  const c = { merah: "bg-red-50 text-red-700 border-red-200",
              kuning: "bg-amber-50 text-amber-700 border-amber-200",
              biru: "bg-blue-50 text-blue-700 border-blue-200" }[warna];
  return <span title={judul} className={cn("rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap", c)}>{children}</span>;
}

export function Kosong({ pesan = "Tidak ada data pada filter ini." }: { pesan?: string }) {
  return <div className="text-muted-foreground flex h-[300px] items-center justify-center text-xs">{pesan}</div>;
}
