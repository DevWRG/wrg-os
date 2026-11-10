// F170 Komite KSO — helper murni untuk daftar "Belum lengkap" & "Lolos tanpa forum" (302) dan
// bagian Lampiran / Yang masih kurang di panel rincian. Tanpa React supaya bisa diuji unit.
//
// Sumber data = apps/api/src/repo/kso-komite.ts (daftarFilter, detailRencana) dan
// apps/api/src/repo/kso-format.ts (daftarKurang, cocokkanLampiran). Daftar "kurang" dihitung API
// dari SATU sumber yang sama dengan balasan WA — layar ini hanya menampilkannya.

import type { TabKso } from "./kso-komite-access";

export type FilterDaftar = "belum-lengkap" | "lolos-tanpa-forum";

/**
 * Tab yang dipakai untuk meminta daftar. Daftar di API disaring RLS peran tab (kso.boleh_lihat):
 * Komite/Sekretaris/Direksi = semua rencana, HOD = wilayahnya, AM = miliknya, Admin Sales = hanya
 * yang sudah diputus HOD. Ambil tab dengan cakupan terluas yang dimiliki pengguna; Teknik tidak
 * pernah melihat rencana sebelum PKS, jadi tidak dipakai. Admin Sales hanya untuk "Lolos".
 */
const URUTAN: Record<FilterDaftar, TabKso[]> = {
  "belum-lengkap": ["agenda", "sekretariat", "direksi", "kpi", "hod", "saya"],
  "lolos-tanpa-forum": ["agenda", "sekretariat", "direksi", "kpi", "hod", "saya", "penawaran"],
};
const CAKUPAN: Record<TabKso, string> = {
  agenda: "semua rencana", sekretariat: "semua rencana", direksi: "semua rencana", kpi: "semua rencana",
  hod: "rencana di wilayah HOD Anda", saya: "rencana Anda", penawaran: "yang diputus HOD (jalur cepat)", teknik: "—",
};

export function pilihTabDaftar<T extends { tab: TabKso }>(tabs: T[], filter: FilterDaftar): { tab: T; cakupan: string } | null {
  for (const k of URUTAN[filter]) {
    const t = tabs.find((x) => x.tab === k);
    if (t) return { tab: t, cakupan: CAKUPAN[k] };
  }
  return null;
}

// ---------------------------------------------------------------- lampiran

export type StatusLampiran = "belum" | "cocok" | "beda" | "galat";

/** Status lampiran terakhir: belum ada · cocok semua · ada selisih · PDF tak terbaca (ok=false). */
export function statusLampiran(l: { lolos: boolean; ok?: boolean | null; galat?: string | null } | null | undefined): StatusLampiran {
  if (!l) return "belum";
  if (l.lolos) return "cocok";
  return l.ok === false || (l.galat != null && l.galat !== "") ? "galat" : "beda";
}

/**
 * 305 — berkas PDF lampiran: "buka" = berkas masih ada (tombol Buka PDF; mis. gagal teknis, disimpan untuk dibaca ulang),
 * "diunggah" = sudah dibaca dan berkasnya tidak disimpan di server, "tanpa" = tak ada berkas (data lama / tak dikenal).
 */
export type KeadaanBerkas = "buka" | "diunggah" | "tanpa";
export function keadaanBerkas(l: { ada_berkas: boolean; dibaca_at?: string | null; berkas_dihapus?: boolean } | null | undefined): KeadaanBerkas {
  if (!l) return "tanpa";
  if (l.ada_berkas) return "buka";
  return l.dibaca_at || l.berkas_dihapus ? "diunggah" : "tanpa";
}

/** "Lampiran simulator sudah diunggah · dibaca 10 Nov 14.05" — waktu baca final (fallback: waktu diunggah). */
export function teksDiunggah(
  l: { dibaca_at?: string | null; diunggah_at?: string | null; dibuat_at?: string | null }, fmt: (s: string | null | undefined) => string,
): string {
  const t = l.dibaca_at ?? l.diunggah_at ?? l.dibuat_at ?? null;
  return t ? `Lampiran simulator sudah diunggah · dibaca ${fmt(t)}` : "Lampiran simulator sudah diunggah";
}

export const LABEL_LAMPIRAN: Record<StatusLampiran, string> = {
  belum: "Belum ada", cocok: "Cocok", beda: "Ada selisih", galat: "PDF tak terbaca",
};

// Sama dengan GALAT_OCR di apps/api/src/repo/kso-format.ts (teksGalatOcr).
const GALAT_OCR: Record<string, string> = {
  "dry-run": "pembaca PDF sedang mode uji",
  "pdf-rusak": "berkas PDF rusak / tidak bisa dibuka",
  "bukan-cprr": "PDF bukan cetakan Simulator KSO",
  "cprr-tidak-terbaca": "angka di PDF tidak terbaca — cetak ulang dari Simulator",
};
export function teksGalatOcr(g: string | null | undefined): string {
  return GALAT_OCR[String(g)] ?? "pembaca PDF sedang gangguan — kirim ulang PDF-nya beberapa menit lagi";
}

/** Urutan tetap baris perbandingan PDF vs WA (kunci = cocokkanLampiran di API). */
export const URUT_COCOK = ["sales", "faskes", "alat", "volume", "tenor", "kompetitor"] as const;

// ---------------------------------------------------------------- yang masih kurang

/**
 * Jumlah isian yang dicek daftarKurang (API): sembilan isian format #KSO (FASKES & ALAT selalu ada
 * begitu draft tercatat) + PENDUKUNG + STATUS UNIT. SUMBER (bukti volume) dan ALASAN strategis hanya
 * dicek pada kondisi tertentu — dihitung bila memang muncul di daftar kurang.
 */
const TOTAL_DASAR = 11;
const KONDISIONAL = new Set(["sumber", "alasan"]);

export function kelengkapan(kurang: { kunci: string }[]): { kurang: number; total: number; terisi: number; persen: number } {
  const unik = new Set(kurang.map((k) => k.kunci));
  const total = TOTAL_DASAR + [...unik].filter((k) => KONDISIONAL.has(k)).length;
  const n = Math.min(unik.size, total);
  const terisi = total - n;
  return { kurang: n, total, terisi, persen: Math.round((terisi / total) * 100) };
}

// ---------------------------------------------------------------- angka & waktu

/** Harga setelah fee (%) — sama dengan kolom harga_bersih API. */
export function hargaBersih(harga: number | null | undefined, feePersen: number | null | undefined): number | null {
  if (harga == null) return null;
  return harga * (1 - (feePersen ?? 0) / 100);
}

export const persenFee = (f: number | null | undefined) =>
  f == null ? "—" : `${f.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

/** "baru saja", "15 menit lalu", "3 jam lalu", "kemarin", "4 hari lalu", "2 bln lalu". */
export function relatif(iso: string | null | undefined, kini: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const menit = Math.floor((kini.getTime() - t) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari === 1) return "kemarin";
  if (hari < 31) return `${hari} hari lalu`;
  return `${Math.floor(hari / 30)} bln lalu`;
}

/** Hari kalender (WIB) dari hariIni ke tanggal `YYYY-MM-DD`; negatif = sudah lewat. */
export function sisaHari(sampai: string | null | undefined, hariIni: string): number | null {
  if (!sampai) return null;
  const a = Date.parse(`${sampai.slice(0, 10)}T00:00:00Z`), b = Date.parse(`${hariIni}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** Mandat dianggap "segera berakhir" bila sisa ≤ 7 hari (termasuk yang sudah lewat). */
export const BATAS_SEGERA = 7;
export type NadaBerlaku = "lewat" | "segera" | "aman" | "kosong";
export function nadaBerlaku(sisa: number | null): NadaBerlaku {
  if (sisa == null) return "kosong";
  if (sisa < 0) return "lewat";
  return sisa <= BATAS_SEGERA ? "segera" : "aman";
}

export function hariIniWib(kini: Date = new Date()): string {
  return kini.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

// ---------------------------------------------------------------- penyaring daftar

export interface SaringBelum { tanpaLampiran: boolean; lampiranBeda: boolean }
/** Dua chip boleh aktif bersamaan = gabungan (tanpa lampiran ATAU lampiran beda). */
export function saringBelumLengkap<T extends { lampiran: { lolos: boolean } | null }>(baris: T[], f: SaringBelum): T[] {
  if (!f.tanpaLampiran && !f.lampiranBeda) return baris;
  return baris.filter((b) => (f.tanpaLampiran && !b.lampiran) || (f.lampiranBeda && !!b.lampiran && !b.lampiran.lolos));
}

export interface SaringLolos { zona: "" | "am" | "hod"; segera: boolean }
export function saringLolos<T extends { zona: string | null; mandat: { berlaku_sampai: string | null } | null }>(
  baris: T[], f: SaringLolos, hariIni: string,
): T[] {
  return baris.filter((b) => (!f.zona || b.zona === f.zona)
    && (!f.segera || ["lewat", "segera"].includes(nadaBerlaku(sisaHari(b.mandat?.berlaku_sampai, hariIni)))));
}

// ---------------------------------------------------------------- format #KSO

/**
 * Templat format #KSO — SALINAN PERSIS KSO_FORMAT_ISIAN di apps/api/src/repo/kso-intake.ts (web tak bisa mengimpor
 * modul API; belum ada endpoint). Uji kso-komite-daftar.test.ts membandingkan keduanya — ubah bersamaan.
 * Contoh nama/faskes sengaja fiktif. KOTA tidak diminta: master customer / area AM.
 */
export const FORMAT_KSO =
  "#KSO BUDI\n" +
  "1. FASKES : RS CONTOH SEJAHTERA\n" +
  "2. ALAT : ZYBIO Z50\n" +
  "3. TES : 700 TEST/BULAN\n" +
  "4. MASA KSO : 36 BULAN\n" +
  "5. PERMINTAAN HARGA : 11.800/TEST\n" +
  "6. FEE : 5% (tulis 0 bila tidak ada fee)\n" +
  "7. KOMPETITOR : MEREK-MODEL-HARGA (atau TIDAK ADA)\n" +
  "8. KLAUSUL : TIDAK (atau ADA - isi klausulnya)\n" +
  "9. LAMPIRAN : ADA — kirim PDF Simulator KSO di chat ini dalam 10 menit\n" +
  "10. STATUS UNIT : BARU / RELOKASI IDLE / EKS KSO / EKS DEMO / REFURBISH / PINJAMAN PRINCIPAL\n" +
  "11. BUKTI VOLUME : REKAP LIS 6 BULAN / PEMBELIAN REAGEN / SURAT RS\n" +
  "12. PENDUKUNG : dr. NAMA, JABATAN (mis. kepala instalasi lab)\n" +
  "(10 dan 11 pilih SATU. Tambahan bila perlu: JUMLAH : 2 bila lebih dari 1 unit · " +
  "HARI KERJA : 26 bila beda dari default · ALASAN : … hanya bila diminta bot)";

export const FORMAT_KSO_TAMBAHAN: [string, string][] = [
  ["Melengkapi / koreksi", "#KSO D12 LABEL: ISI (mis. #KSO D12 PENDUKUNG: dr. Contoh, kepala instalasi lab)"],
  ["PDF menyusul", "kirim \"#KSO D12\" lalu PDF-nya dalam 10 menit"],
  ["Diajukan", "data lengkap + PDF cocok → diajukan otomatis; manual: #KSO kirim D12"],
  ["Volume RS turun sesudah mandat", "#KSO D12 volume 900 (turun > 20% → mandat dihitung ulang)"],
];
