// F170 Komite KSO — margin & HPP tak terlihat oleh peran yang tak berhak (keputusan product owner 10 Nov 2026).
//
//   "Pokoknya semua yang berhubungan dengan margin dan HPP dihilangkan dari penglihatan AM."
//   Yang BOLEH melihat angka: HOD Business, Komite, Sekretariat, Direksi (+ admin/superuser, Finance pengisi angka).
//   TIDAK boleh: AM, HOD Sales (kursi HOD jenis 'area'), Admin Sales, Teknik.
//
// Berkas ini MURNI (tanpa DB) supaya bisa diuji: alasan gerbang tanpa angka (balasan WA + layar), dan penyaring
// respons API. Penyaring dipasang di API (repo/kso-komite.ts), bukan hanya disembunyikan di layar.

// ---------------------------------------------------------------- gerbang tanpa angka

/** Nama pendek tujuh gerbang (nama di database memuat angka batas, mis. "Tenor ≤ 60 bulan"). */
export const NAMA_GERBANG: Record<number, string> = {
  1: "GPM deal", 2: "Volume terbukti", 3: "Relokasi dulu", 4: "Coverage + teknisi", 5: "Piutang faskes", 6: "Tenor", 7: "Klausul standar",
};

/**
 * Alasan singkat TANPA ANGKA untuk gerbang yang tidak hijau ('merah' maupun 'belum'); null = tanpa alasan.
 * Gerbang 1 merah sengaja tanpa alasan (alasannya angka GPM). Sumber teks = kso.hitung_gerbang (266).
 */
export function alasanGerbang(no: number, status: string, nilai: string | null | undefined): string | null {
  if (status === "hijau") return null;
  const t = (nilai ?? "").toLowerCase();
  if (status !== "merah") {
    if (no === 1 && /hemodialisa/.test(t)) return "Hemodialisa — diputus Direktur";
    if (no === 2) return /belum diisi/.test(t) ? "belum ada data" : /verifikasi sekretaris/.test(t) ? "menunggu verifikasi Sekretaris" : "belum ada bukti";
    return "belum ada data";
  }
  switch (no) {
    case 1: return /belum ada di database/.test(t) ? "alat belum ada di database" : null; // 307: alat baru
    case 2: return /ditolak/.test(t) ? "bukti ditolak Sekretaris" : /lisan/.test(t) ? "perkiraan lisan tidak diterima" : "belum ada bukti";
    case 3: return "ada unit idle sejenis — relokasi dulu";
    case 4: return /luar coverage/.test(t) ? "di luar coverage cabang" : "belum ada teknisi di cabang";
    case 5: return "piutang faskes melewati batas";
    case 6: return "melebihi batas tenor";
    case 7: return "klausul khusus";
    default: return null;
  }
}

/** Nilai gerbang 1 untuk layar yang disaring: tanpa persen GPM/zona. Gerbang lain tak memuat margin → apa adanya. */
export function nilaiGerbangAman(no: number, status: string, nilai: string | null): string | null {
  if (no !== 1) return nilai;
  if (status === "hijau") return "Memenuhi";
  return alasanGerbang(1, status, nilai) ?? "Belum memenuhi — wajib alasan strategis";
}

// ---------------------------------------------------------------- penyaring respons API

/**
 * Mode penyaring per tab:
 *   "semua"   — AM, HOD Sales, Teknik: semua angka margin/HPP/mandat dibuang.
 *   "pembuka" — Admin Sales: sama, KECUALI harga pembuka mandat (= harga yang dicetak di penawaran yang mereka
 *               terbitkan; form "Terbitkan penawaran" memakainya sebagai harga awal). Target & batas bawah dibuang.
 */
export type ModeSaring = "semua" | "pembuka";

/** Kolom rencana / baris daftar yang memuat margin atau HPP. capex = harga PO alat × jumlah (HPP alat). */
const KOLOM_RENCANA = ["capex", "payback_bulan", "biaya_instalasi", "gpm_deal", "zona_dasar", "harga_bersih", "harga_standar"] as const;
/** Kolom mandat yang berupa harga/biaya. harga_pembuka hanya disisakan untuk mode "pembuka". */
const HARGA_MANDAT = ["harga_lantai", "harga_target", "harga_pembuka", "capex_maks"] as const;
/** Isian OCR PDF Simulator yang berupa biaya (CPRR & pecahannya, markup, capex). */
export const BIAYA_OCR = ["capex_total", "markup_persen", "capex_per_test", "reagen_per_test", "qc_per_test", "base_cost_per_test", "cprr_per_test"] as const;
const KATA_BIAYA = /capex|cprr|base_cost|reagen|markup|qc_per|hpp|biaya|gpm|margin/i;

type Obj = Record<string, unknown>;
const buang = (o: Obj, kunci: readonly string[]) => { for (const k of kunci) delete o[k]; };
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function saringMandat(m: unknown, mode: ModeSaring): unknown {
  if (!obj(m)) return m;
  const x = { ...m };
  buang(x, HARGA_MANDAT.filter((k) => !(mode === "pembuka" && k === "harga_pembuka")));
  return x;
}

/** Satu baris antrean / daftar (v_antrean, daftar belum-lengkap / lolos-tanpa-forum). */
export function saringBaris<T extends Obj>(b: T, mode: ModeSaring): T {
  const x: Obj = { ...b };
  buang(x, KOLOM_RENCANA);
  if ("mandat" in x) x.mandat = saringMandat(x.mandat, mode);
  return x as T;
}

/** Pita ringkasan (kso.v_ringkasan): capex disetujui = HPP alat. */
export function saringRingkasan<T extends Obj | undefined>(r: T): T {
  if (!r) return r;
  const x: Obj = { ...r };
  delete x.capex_disetujui;
  return x as T;
}

function saringLampiran(l: unknown): unknown {
  if (!obj(l)) return l;
  const x: Obj = { ...l };
  if (obj(x.isian)) {
    const i = { ...x.isian };
    buang(i, BIAYA_OCR);
    x.isian = i;
  }
  if (Array.isArray(x.peringatan)) x.peringatan = x.peringatan.filter((p) => !KATA_BIAYA.test(String(p)));
  return x;
}

/** GET /kso-komite/:tab — pita ringkasan + antrean. */
export function saringDaftarTab<T extends Obj>(d: T, mode: ModeSaring): T {
  const x: Obj = { ...d, tanpa_angka: true };
  if (obj(x.ringkasan)) x.ringkasan = saringRingkasan(x.ringkasan);
  for (const k of ["baris", "verifikasi", "agenda"]) if (Array.isArray(x[k])) x[k] = (x[k] as Obj[]).map((b) => saringBaris(b, mode));
  return x as T;
}

/** GET /kso-komite/:tab/daftar/:filter. */
export function saringDaftarFilter<T extends Obj>(d: T, mode: ModeSaring): T {
  const x: Obj = { ...d, tanpa_angka: true };
  if (Array.isArray(x.baris)) x.baris = (x.baris as Obj[]).map((b) => saringBaris(b, mode));
  return x as T;
}

/** GET /kso-komite/:tab/rencana/:id — rincian satu rencana. */
export function saringDetail<T extends Obj>(d: T, mode: ModeSaring): T {
  const x: Obj = { ...d, tanpa_angka: true, angka_gpm: null };
  if (obj(x.rencana)) x.rencana = saringBaris(x.rencana, mode);
  x.mandat = saringMandat(x.mandat, mode);
  if (Array.isArray(x.gerbang))
    x.gerbang = (x.gerbang as Obj[]).map((g) => ({ ...g, nilai: nilaiGerbangAman(Number(g.no), String(g.status), (g.nilai as string | null) ?? null) }));
  // usulan komite: mandat yang diusulkan ke Direksi = harga
  if (Array.isArray(x.usulan)) x.usulan = (x.usulan as Obj[]).map((u) => { const y = { ...u }; delete y.mandat_usulan; return y; });
  if (Array.isArray(x.lampiran)) x.lampiran = (x.lampiran as unknown[]).map(saringLampiran);
  if ("lampiran_terakhir" in x) x.lampiran_terakhir = saringLampiran(x.lampiran_terakhir);
  return x as T;
}

// ---------------------------------------------------------------- penjaga uji: teks untuk AM

/**
 * Pola yang TIDAK boleh muncul di teks yang dikirim ke AM (dan HOD Sales / Admin Sales): persen GPM, persen apa pun,
 * rupiah, kata biaya/HPP/CPRR/cicilan/markup/margin, harga mandat. Dipakai unit test; dikembalikan pola yang kena.
 */
export const POLA_TERLARANG: [string, RegExp][] = [
  ["GPM angka", /GPM\s*[\d(]/i],
  ["persen", /\d[\d.,]*\s*%/],
  ["rupiah", /\bRp\s?\d|\bRp\b/],
  ["biaya", /\bbiaya\b/i],
  ["HPP", /\bHPP\b/i],
  ["CPRR", /CPRR/i],
  ["cicilan", /cicilan/i],
  ["markup", /markup/i],
  ["margin", /\bmargin\b/i],
  ["harga mandat", /harga\s+(?:pembuka|target|lantai|minimum)|batas\s+bawah\s+(?:Rp|\d)/i],
];
export function polaTerlarang(teks: string): string[] {
  return POLA_TERLARANG.filter(([, re]) => re.test(teks)).map(([n]) => n);
}
