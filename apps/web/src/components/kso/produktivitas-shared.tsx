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

// Kunci grup faskes×skema. DIEKSTRAK jadi fungsi karena dipakai DUA tempat: pengelompokan
// untuk tampilan, dan penyaringan baris ASET untuk export. Kalau disalin, export bisa
// menyaring dengan kunci yang berbeda dari yang dikelompokkan — dan selisihnya tidak akan
// memunculkan error, cuma berkas yang isinya tidak cocok dengan layar.
//
// account_id null (mis. skema UNKNOWN belum terpetakan) → jatuh ke nama sheet, supaya
// baris tanpa account tidak semuanya menggumpal jadi satu grup.
export const kunciGrup = (r: KsoProduktivitasRow) =>
  `${r.skema}::${r.accountId ?? `raw:${r.customerRaw}`}`;

export function kelompokkan(rows: KsoProduktivitasRow[]): FaskesRow[] {
  const map = new Map<string, FaskesRow>();
  for (const r of rows) {
    const key = kunciGrup(r);
    const g = map.get(key);
    if (g) { if (r.namaAlat) g.alatList.push(r.namaAlat); continue; }
    map.set(key, {
      key, faskes: r.faskes ?? r.customerRaw, kota: r.kota,
      alatList: r.namaAlat ? [r.namaAlat] : [], r,
    });
  }
  return [...map.values()];
}

// ── Rp per ALAT: metrik untuk BELI_REAGEN, BUKAN pengganti Rp/tes ─────────────────
// Rp/tes tidak berlaku untuk skema BELI_REAGEN: hanya 4 dari 329 aset melaporkan tes
// (di skema itu yang ditagih reagennya, bukan tesnya), jadi penyebutnya praktis tak ada.
//
// Penyebut per-tes juga TIDAK BISA diturunkan dari reagen — dua jalan sudah diuji habis:
//   * nama item -> tes-per-kemasan: cuma 32% NILAI yang terurai. Sisanya reagen cair
//     bervolume (lyse 500 mL, diluent 20 L) yang tak punya angka tes di namanya dan tak
//     akan pernah punya — tes per liter bergantung mesin & volume aspirasi per siklus.
//   * faktor empiris dari faskes PER_TEST yang melapor: bahannya ADA (70% nilai), tapi
//     metodenya GAGAL UJI KALIBRASI. Diuji pada item yang jumlah tesnya tercetak di
//     namanya, ia melebihkan sampai 53x dan mengecilkan sampai 0,37x; 1 dari 7 yang kena.
//     Metode yang tak bisa memulihkan angka yang DIKETAHUI tak boleh dipakai untuk angka
//     yang tidak diketahui. (Biasnya: pembilang = total tes faskes dibagi qty SATU item,
//     jadi faskes yang beli 10 item berbeda otomatis memberi faktor 10x lebih besar.)
// Sebabnya struktural: pembelian reagen mengikuti siklus STOK, bukan siklus tes — satu
// botol lyse bertahan lama di klinik kecil dan cepat habis di RS besar. Struktur kontrak
// BELI_REAGEN ternyata mencerminkan sifat datanya, bukan kebetulan administratif.
//
// APA YANG DIUKURNYA: besar belanja per alat. **BUKAN produktivitas** — ia tak bisa
// menjawab "alat ini dipakai atau tidak"; itu hanya terjawab oleh laporan tes. Sebarannya
// juga 3x lebih lebar dari Rp/tes (IQR 12,8x vs 3,7x), jadi daya bedanya antar faskes
// lebih lemah dan sebagian besar sebaran berasal dari UKURAN faskes, bukan efisiensi.
//
// KENAPA PEMBAGIAN INI BOLEH DI TS, padahal #998 dihukum karena menghitung di TS: yang
// dilarang adalah menurunkan ATURAN (porsi, atribusi kategori) — di sana ada keputusan
// bisnis yang bisa berubah lalu menyimpang dari SQL. Di sini tidak ada keputusan: aturan
// "alat mana yang dihitung" tetap tinggal di SQL (`alat_seskema_di_customer`), dan baris
// ini cuma membaginya. Kalau kelak definisinya berubah (mis. hanya alat aktif), yang
// berubah kolom SQL-nya — bukan baris ini.
export function rupiahPerAlat(r: KsoProduktivitasRow): number | null {
  if (r.revenueNettoCustomer === null) return null;
  const alat = r.alatSeskemaDiCustomer;
  if (alat === null || alat <= 0) return null;
  return r.revenueNettoCustomer / alat;
}

// Rp/tes hanya bermakna di PER_TEST. Dipakai untuk memilih kolom mana yang tampil,
// supaya keputusan itu hidup di SATU tempat alih-alih diulang di tabel & dialog.
export const skemaPakaiRpTes = (skema: string) => skema === "PER_TEST";

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

// ── Skala sumbu rupiah ─────────────────────────────────────────────────────────────
// SATU satuan untuk seluruh sumbu, dipilih dari nilai terbesarnya — bukan per-nilai
// seperti rpSingkat. Dua sebab, dua-duanya terlihat di layar sebelum ini diperbaiki:
//
//   1. LABEL DUPLIKAT. rpSingkat membulatkan ke satuan terdekat tanpa desimal, jadi
//      1.950.000 dan 1.650.000 SAMA-SAMA jadi "2 jt". Sumbu yang menampilkan "2 jt"
//      dua kali pada tinggi berbeda membuat seluruh grafik terbaca rusak.
//   2. SATUAN CAMPUR. "2 jt" lalu "975 rb" di sumbu yang sama memaksa pembaca
//      mengkonversi di kepala untuk membandingkan dua tick bersebelahan.
//
// Desimal ditentukan dari rentangnya: makin sempit rentang, makin banyak desimal yang
// dibutuhkan agar tick tidak runtuh jadi label yang sama.
export function skalaRp(maks: number) {
  const a = Math.abs(maks);
  const [bagi, satuan] =
    a >= 1e9 ? [1e9, "miliar Rp"] :
    a >= 1e6 ? [1e6, "juta Rp"] :
    a >= 1e3 ? [1e3, "ribu Rp"] : [1, "Rp"];
  const rasio = a / bagi;
  const desimal = rasio < 3 ? 2 : rasio < 10 ? 1 : 0;
  return {
    satuan,
    format: (v: number) =>
      (v / bagi).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: desimal }),
  };
}

// Sumbu HITUNGAN (jumlah tes) — pemisah ribuan, tanpa satuan singkat. rpSingkat pernah
// dipakai di sini dan itu salah: 14.225 tes jadi "14 rb", presisi yang justru dibutuhkan
// saat membandingkan realisasi dengan target hilang.
export const angkaSumbu = (v: number) => Math.round(v).toLocaleString("id-ID");

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// 'YYYY-MM-DD' dipotong manual, TIDAK lewat new Date(): konstruktor Date menafsirkan
// string itu sebagai UTC lalu ditampilkan di zona lokal, sehingga 2026-01-01 bisa
// terbaca "Des 2025" di WIB — seluruh grafik meleset satu bulan.
export const labelBulan = (periode: string) => {
  const [y, m] = periode.split("-");
  return `${BULAN[Number(m) - 1] ?? m} ${y.slice(2)}`;
};

export const SEMUA = "__semua__";

// ── Rentang bulan ──────────────────────────────────────────────────────────────────
// Semua periode berbentuk 'YYYY-MM-01' dan dibandingkan sebagai STRING. Perbandingan
// leksikografis pada format itu identik dengan urutan waktu, dan menghindari Date sama
// sekali — satu-satunya cara memastikan tidak ada pergeseran zona waktu.
const dua = (n: number) => String(n).padStart(2, "0");

// Bulan berjalan menurut jam lokal pemakai (getMonth, BUKAN UTC): di WIB tanggal 1
// pukul 00:30, versi UTC masih menunjuk bulan sebelumnya.
export function bulanIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-01`;
}
export function awalTahunIni(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// Deret bulan lengkap dari..sampai (inklusif). Dipakai untuk merangka sumbu-x grafik
// tren: tanpa ini bulan yang TIDAK ADA barisnya hilang dari sumbu, sehingga grafik
// terlihat rapat & bersambung padahal ada bulan yang tidak dilaporkan. Dengan deret
// lengkap + connectNulls={false}, bulan kosong tampil sebagai putusnya garis.
export function deretBulan(dari: string, sampai: string): string[] {
  if (dari > sampai) return [];
  const out: string[] = [];
  let [y, m] = [Number(dari.slice(0, 4)), Number(dari.slice(5, 7))];
  const batas = sampai.slice(0, 7);
  for (let i = 0; i < 240; i++) {          // pagar 20 tahun; rentang KSO jauh lebih pendek
    const p = `${y}-${dua(m)}`;
    out.push(`${p}-01`);
    if (p >= batas) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// ── Brand alat ─────────────────────────────────────────────────────────────────────
// Diturunkan dari `nama_alat`; TIDAK ada kolom brand di kso_asset maupun di sheet.
//
// KENAPA PETA EKSPLISIT, BUKAN "ambil kata pertama": pada 63 nama alat yang ada, kata
// pertama benar untuk sebagian besar (Zybio, Wondfo, Clover, Erba) tapi memecah yang
// justru paling banyak. Seri MEK — MEK-6318/6410/6510/7222/7300/8222, 31 unit — akan
// jadi ENAM "brand" berbeda padahal satu keluarga Celltac Nihon Kohden. Begitu pula
// 'I Smart 30' vs 'ISMART 300' (dua ejaan, satu alat) dan 'ED-Lyte5' vs
// 'Ediagnosis ED-Lyte5'. Filter yang memecah satu brand jadi beberapa baris tidak
// sekadar berantakan — ia membuat orang menyimpulkan brand itu kecil.
//
// Pola diuji berurutan; yang pertama cocok menang. Nama yang tidak cocok pola mana pun
// jatuh ke kata pertamanya (lihat brandAlat) — jadi alat baru tetap muncul sebagai brand
// yang masuk akal tanpa harus mengubah berkas ini lebih dulu.
//
// EJAANNYA MENGIKUTI `brand_alias` (migrasi 108/109), bukan selera berkas ini. Tanpa itu
// brand yang sama tampil berbeda di dua menu — /pipeline menulis 'ZYBIO', halaman ini
// menulis 'Zybio' — dan siapa pun yang kelak menyandingkan deal dengan aset KSO lewat
// brand akan mendapat join yang gagal diam-diam, tanpa satu pun error.
//
// 17 ejaan diselaraskan ke daftar rename otoritatif di 109 (mis. 'Nihon Kohden' → 'NIHON'
// karena daftar resmi user menulis 'NIHON' saja) ditambah tiga yang komentar 109 sebut
// dibiarkan memakai ejaan data ('Wiener lab', 'Vesmatic', 'Klyte').
//
// INI JEMBATAN, BUKAN PENYELESAIAN — masih dua sumber kebenaran. Kalau daftar resmi
// berubah lagi, berkas ini TIDAK ikut dan tidak ada yang menandainya. Perbaikan
// sesungguhnya: resolusi lewat `brand_alias` di server. Sampai itu ada, periksa berkala:
//     SELECT DISTINCT canonical FROM brand_alias ORDER BY 1;
//
// Brand di bawah yang TIDAK muncul di daftar rename 109 (Erba, Fresenius, Metrolab,
// Ediagnosis, Pictus, Liaison, SHM, Biolis, TMS, Mindray, Succeeder, BSI, NanoEntek,
// BioSet, Eti Max, DNM, Sclavo, Dus) dibiarkan apa adanya — sebagian memang khas alat
// KSO dan tidak pernah muncul sebagai brand deal.
const BRAND: Array<[RegExp, string]> = [
  [/^MEK-/i, "NIHON"],          // seri Celltac; satu-satunya yang WAJIB dipetakan
  [/^ZYBIO/i, "ZYBIO"],
  [/^WONDFO/i, "WONDFO"],
  [/^CLOVER/i, "CLOVER"],
  [/^WIENERLAB/i, "Wiener lab"],
  [/^METROLAB/i, "Metrolab"],
  [/^ERBA/i, "Erba"],
  [/^VESMATIC/i, "Vesmatic"],
  [/^DORA/i, "DORA"],
  [/^FRESENIUS/i, "Fresenius"],
  [/^WEGO/i, "WEGO"],
  [/^T-?COAG/i, "TCOAG"],
  [/^BIOCROSS/i, "BIOCROSS"],
  [/^(EDIAGNOSIS|ED-LYTE)/i, "Ediagnosis"],
  [/^K[\s-]?LYTE/i, "Klyte"],
  [/^I[\s-]?SMART/i, "I-SMART"],
  [/^LIAISON/i, "Liaison"],
  [/^PICTUS/i, "Pictus"],
  [/^BIOLIS/i, "Biolis"],
  [/^MINDRAY/i, "Mindray"],
  [/^SNIBE/i, "SNIBE"],
  [/^TOSOH/i, "TOSOH"],
  [/^TMS/i, "TMS"],
  [/^SHM/i, "SHM"],
  [/^ETI\s?MAX/i, "Eti Max"],
  [/^KONSUNG/i, "KONSUNG"],
  [/^NANOENTEK/i, "NanoEntek"],
  [/^SUCCEEDER/i, "Succeeder"],
  [/^SCLAVO/i, "Sclavo"],
  [/^BIOSET/i, "BioSet"],
  [/^VIVACHEK/i, "VIVACHEK"],
  [/^(URIN\s+)?DUS\s/i, "Dus (urinalisis)"],
  [/^GLUCOSE\s+XPER/i, "XPER"],
  [/^DNM-/i, "DNM"],
  [/^BIOCHEMICAL\s+SYSTEM/i, "BSI"],
];

export function brandAlat(namaAlat: string | null | undefined): string {
  const s = String(namaAlat ?? "").trim();
  if (!s) return "(tanpa nama alat)";
  for (const [pola, nama] of BRAND) if (pola.test(s)) return nama;
  // Cadangan: kata pertama APA ADANYA. Sengaja tidak "(lainnya)" — satu keranjang
  // serba-ada menyembunyikan brand baru alih-alih menampakkannya. Dan sengaja tidak
  // dinormalkan huruf besar/kecilnya: 'GCU' akan jadi 'Gcu' dan 'Hubby-Quant' jadi
  // 'Hubby-quant', dua-duanya salah tulis. Pada 63 nama alat yang ada sekarang hanya
  // dua yang sampai ke sini, dan keduanya sudah benar apa adanya.
  return s.split(/\s+/)[0];
}

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
  brand: string; setBrand: (v: string) => void;
  alat: string; setAlat: (v: string) => void;
  penanda: string; setPenanda: (v: string) => void;
  dasar: FaskesRow[]; rows: FaskesRow[];
  // Baris ASET (bukan faskes) yang lolos filter — untuk export per-aset. Lihat komentar
  // di useFilterKso: tabel dikelompokkan per faskes, tapi export butuh level aset supaya
  // kolom per-alat (target, tes alat, capaian) punya pemilik yang jelas.
  mentah: KsoProduktivitasRow[];
  // Basis hitungan penanda (tanpa ambang layak) + berapa faskes yang ambang itu sembunyikan.
  dasarSkema: FaskesRow[]; disembunyikan: number;
  opsiKota: string[]; opsiBrand: string[]; opsiAlat: string[];
  median: number | null; adaFilter: boolean; reset: () => void;
}

export function useFilterKso(data: KsoProduktivitas): FilterKso {
  const [skema, setSkema] = useState("PER_TEST");
  // Default HANYA yang layak diperingkat. Membuka halaman langsung pada daftar penuh
  // berarti baris teratasnya alat 1-4 tes dengan Rp/tes ratusan juta — pembalikan makna
  // yang justru ditutup migrasi 100.
  const [hanyaLayak, setHanyaLayak] = useState(true);
  const [kota, setKota] = useState(SEMUA);
  const [brand, setBrand] = useState(SEMUA);
  const [alat, setAlat] = useState(SEMUA);
  const [penanda, setPenanda] = useState(SEMUA);

  // Dasar = skema + ambang layak. Opsi kota/alat diturunkan dari SINI, bukan dari hasil
  // akhir — kalau dari hasil yang sudah tersaring, memilih satu kota akan mengosongkan
  // daftar kota itu sendiri dan filternya mengunci diri.
  const dasar = useMemo(
    () => kelompokkan(data.rows.filter((r) => r.skema === skema && (!hanyaLayak || r.basisTesMemadai))),
    [data.rows, skema, hanyaLayak],
  );

  // Seluruh faskes skema ini TANPA ambang layak. Dipakai untuk dua hal yang tidak boleh
  // dihitung dari `dasar`:
  //
  //  1. Hitungan di dropdown Penanda. Dulu diturunkan dari `dasar`, dan karena `dasar`
  //     sudah membuang penyebut tipis saat `hanyaLayak` menyala (bawaan), opsinya selalu
  //     berbunyi "Penyebut tipis (0)" — filter yang paling perlu justru tampak tidak ada
  //     isinya, dan memilihnya mengosongkan tabel.
  //  2. Jumlah yang disembunyikan ambang. Pada skema BELI_REAGEN hampir seluruh isinya
  //     tersaring (pelaporan tes praktis tidak dijalankan di skema itu — 4 dari 329 aset
  //     melapor di 2026), jadi daftar pendek di sana berarti "tidak dilaporkan", BUKAN
  //     "KSO reagennya sedikit". Tanpa angkanya disebut, pembaca menyimpulkan yang kedua.
  const dasarSkema = useMemo(
    () => kelompokkan(data.rows.filter((r) => r.skema === skema)),
    [data.rows, skema],
  );
  const disembunyikan = useMemo(
    () => dasarSkema.filter((g) => !g.r.basisTesMemadai).length,
    [dasarSkema],
  );

  const opsiKota = useMemo(
    () => [...new Set(dasar.map((g) => g.kota).filter((k): k is string => !!k))].sort((a, b) => a.localeCompare(b, "id")),
    [dasar],
  );
  const opsiBrand = useMemo(
    () => [...new Set(dasar.flatMap((g) => g.alatList.map(brandAlat)))].sort((a, b) => a.localeCompare(b, "id")),
    [dasar],
  );
  // Daftar Alat MENYEMPIT mengikuti Brand yang dipilih — satu-satunya opsi yang boleh
  // begitu, karena Brand adalah induk Alat: menyodorkan 'Zybio Z3' saat brand Wondfo
  // terpilih menghasilkan pilihan yang pasti mengosongkan tabel. Kota & Brand sendiri
  // tetap diturunkan dari `dasar` supaya filternya tidak pernah mengunci diri.
  const opsiAlat = useMemo(
    () => [...new Set(dasar.flatMap((g) => g.alatList)
      .filter((a) => brand === SEMUA || brandAlat(a) === brand))]
      .sort((a, b) => a.localeCompare(b, "id")),
    [dasar, brand],
  );

  const rows = useMemo(() => {
    const p = PENANDA.find((x) => x.id === penanda);
    return dasar.filter((g) =>
      (kota === SEMUA || g.kota === kota) &&
      (brand === SEMUA || g.alatList.some((a) => brandAlat(a) === brand)) &&
      (alat === SEMUA || g.alatList.includes(alat)) &&
      (!p || p.uji(g.r)));
  }, [dasar, kota, brand, alat, penanda]);

  // Baris ASET yang lolos filter, diturunkan dari kunci grup yang LOLOS — bukan dengan
  // mengulang seluruh syarat filter di level aset. Mengulangnya berarti dua definisi
  // "lolos filter" yang bisa menyimpang; memakai kunci membuat keduanya tidak mungkin
  // berbeda. Dipakai export supaya kolom per-alat punya pemilik yang jelas: pada tabel,
  // 4 kolom itu ikut baris perwakilan grup, sehingga SEKAR LANGIT (2 alat) mengekspor
  // "tes alat ini 1" tanpa menyebut alat mana — mencampur level faskes dengan level aset.
  const mentah = useMemo(() => {
    const lolos = new Set(rows.map((g) => g.key));
    return data.rows.filter((r) => lolos.has(kunciGrup(r)));
  }, [data.rows, rows]);

  return {
    skema, setSkema, hanyaLayak, setHanyaLayak, kota, setKota, brand, setBrand,
    alat, setAlat, penanda,
    // Memilih "Penyebut tipis" sambil "hanya yang layak" masih menyala adalah permintaan
    // yang saling membatalkan — hasilnya selalu kosong. Ambangnya dimatikan otomatis
    // supaya pilihan itu berarti, alih-alih menyodorkan tabel kosong yang harus ditebak
    // sendiri sebabnya. Arah sebaliknya tidak diutak-utik: menyalakan ambang lagi memang
    // wajar berarti "sudah, sembunyikan lagi".
    setPenanda: (v: string) => {
      setPenanda(v);
      if (v === "penyebut_tipis") setHanyaLayak(false);
    },
    dasar, rows, dasarSkema, disembunyikan, mentah, opsiKota, opsiBrand, opsiAlat,
    median: data.ringkasan.medianRpPerTes[skema] ?? null,
    adaFilter: kota !== SEMUA || brand !== SEMUA || alat !== SEMUA || penanda !== SEMUA,
    reset: () => { setKota(SEMUA); setBrand(SEMUA); setAlat(SEMUA); setPenanda(SEMUA); },
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

        <Pilih label="Brand" value={f.brand} onChange={(v) => { f.setBrand(v); f.setAlat(SEMUA); }}>
          <option value={SEMUA}>Semua brand ({f.opsiBrand.length})</option>
          {f.opsiBrand.map((b) => <option key={b} value={b}>{b}</option>)}
        </Pilih>

        <Pilih label="Alat" value={f.alat} onChange={f.setAlat}>
          <option value={SEMUA}>Semua alat ({f.opsiAlat.length})</option>
          {f.opsiAlat.map((a) => <option key={a} value={a}>{a}</option>)}
        </Pilih>

        <Pilih label="Penanda" value={f.penanda} onChange={f.setPenanda}>
          <option value={SEMUA}>Semua</option>
          {PENANDA.map((p) => (
            // Dihitung dari `dasarSkema`, BUKAN `dasar` — lihat komentarnya di useFilterKso.
            <option key={p.id} value={p.id}>{p.label} ({f.dasarSkema.filter((g) => p.uji(g.r)).length})</option>
          ))}
        </Pilih>

        <label className="flex cursor-pointer items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={f.hanyaLayak} onChange={(e) => f.setHanyaLayak(e.target.checked)} />
          Hanya yang layak diperingkat
          {/* Jumlahnya disebut hanya saat ambangnya sedang menyembunyikan sesuatu. Daftar
              pendek tanpa keterangan terbaca sebagai "memang segini isinya" — padahal di
              BELI_REAGEN artinya tesnya tidak dilaporkan. */}
          {f.hanyaLayak && f.disembunyikan > 0 ? (
            <span className="text-muted-foreground text-xs"
                  title="Penyebut < 100 tes/thn. Buka penanda 'Penyebut tipis' untuk melihatnya.">
              ({f.disembunyikan} disembunyikan)
            </span>
          ) : null}
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
