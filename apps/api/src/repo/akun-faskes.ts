// Penaut nama faskes tulisan bebas (laporan kunjungan AM) → accurate_customer.
//
// Kenapa modul sendiri (13 Okt 2026): 3.999 dari 4.791 baris activity_log di prod
// tak punya account_id, sehingga Timeline Accounts (filter Aktivitas AM) nyaris
// kosong. Penaut lama (resolveActivityLinks) membandingkan trigram nama UTUH,
// padahal (a) AM menulis "Cust : Puskesmas Trenggalek" dan (b) Accurate menyimpan
// nama TERBALIK: "TRENGGALEK, PKM KAB. TRENGGALEK". Trigram atas dua bentuk itu
// hampir tak pernah lolos ambang.
//
// Prinsip — tautan salah lebih buruk dari kosong (revenue/riwayat nyasar tak
// terlihat di angka mana pun):
//   • JENIS faskes adalah PEMBEDA, bukan kata buang. "PKM Gondang Legi" ≠ "RSI
//     Gondang Legi" (pelajaran scripts/ops/kso-account-match.mjs). Bila AM menulis
//     jenisnya, kandidat wajib berjenis sama.
//   • Kata nama Accurate harus ada SEMUA di tulisan AM (tier 1), atau — bila AM
//     menulis jenisnya — tulisan AM harus ada semua di nama Accurate (tier 2).
//   • Lebih dari satu faskes berbeda lolos = TIDAK ditautkan (ambigu).

import { db } from "../db.js";

export type Jenis = "PKM" | "RS" | "KLINIK" | "LABKESDA" | "DINKES" | "PMI" | "APOTEK" | "BADAN" | "PRIBADI";

const JENIS_KATA: Record<string, Jenis> = {
  pkm: "PKM", puskesmas: "PKM", pusk: "PKM", pukesmas: "PKM", puskemas: "PKM",
  rs: "RS", rsu: "RS", rsud: "RS", rsd: "RS", rsi: "RS", rsia: "RS", rsab: "RS", rskia: "RS", rsj: "RS",
  rsup: "RS", rsupp: "RS", rsau: "RS", rsal: "RS", rspal: "RS", rsk: "RS", rsgm: "RS", rsui: "RS", rsb: "RS",
  rsbp: "RS", rsm: "RS", rsml: "RS", rsuam: "RS",
  klinik: "KLINIK", klink: "KLINIK", clinic: "KLINIK", lab: "KLINIK", laboratorium: "KLINIK", labklin: "KLINIK",
  labkesda: "LABKESDA",
  dinkes: "DINKES",
  pmi: "PMI", utd: "PMI", udd: "PMI",
  apt: "APOTEK", apotek: "APOTEK", apotik: "APOTEK",
  pt: "BADAN", cv: "BADAN",
  bu: "PRIBADI", bpk: "PRIBADI", bdn: "PRIBADI", bidan: "PRIBADI",
};

// Frasa yang ditulis panjang → satu token jenis (dicek sebelum dipecah per kata).
const FRASA: [RegExp, string][] = [
  [/\brumah\s+sakit(\s+umum)?(\s+daerah)?\b/g, " rs "],
  [/\bdinas\s+kesehatan\b/g, " dinkes "],
  [/\blaboratorium\s+kesehatan\s+daerah\b/g, " labkesda "],
  [/\bpalang\s+merah\s+indonesia\b/g, " pmi "],
  [/\bunit\s+transfusi\s+darah\b/g, " utd "],
  [/\bibu\s+(dan\s+|&\s*)?anak\b/g, " "],
  [/\bumum\s+daerah\b/g, " "],
];

// Gelar & kata isi yang tak membedakan faskes. Sengaja pendek.
const GELAR = new Set([
  "dr", "drg", "drh", "h", "hj", "prof", "ir", "drs", "dra", "st", "sp", "se", "kh", "hc",
  "ki", "ageng", "nyi", "ra", "rm", "rr", "ny", "dan", "di", "the", "umum", "daerah",
]);

// Kata yang dipakai banyak faskes sekaligus — tak cukup sebagai satu-satunya
// pegangan tautan tier 2 ("RS Mitra Medika" bukan bukti "MITRA SEHAT MEDIKA").
const KATA_UMUM = new Set([
  "medika", "medical", "medis", "husada", "sehat", "sejahtera", "mitra", "islam", "muhammadiyah", "pku",
  "bunda", "ibu", "anak", "mata", "paru", "jiwa", "permata", "harapan", "kasih", "sentosa", "utama",
  "pratama", "unit", "wilayah", "utara", "selatan", "timur", "barat", "tengah", "baru", "lama", "indah",
  "sari", "jaya", "makmur", "mulia", "bhakti", "bakti", "karya", "graha", "citra", "insani", "sakti",
  "persada", "nusantara", "indonesia", "rumah", "keluarga", "kesehatan", "laboratorium", "klinik",
  "1", "2", "3", "i", "ii", "iii",
]);
const KUALIFIKASI: Record<string, "KOTA" | "KAB"> = { kota: "KOTA", kab: "KAB", kabupaten: "KAB", kodya: "KOTA", kotamadya: "KOTA" };

/** Ejaan lama & variasi umum disamakan: Toeloengredjo ≡ Tulungrejo-ish, Tjipto ≡ Cipto. */
function normKata(w: string): string {
  return w.replace(/oe/g, "u").replace(/dj/g, "j").replace(/tj/g, "c");
}

function kataDari(s: string): string[] {
  let t = ` ${s.toLowerCase()} `;
  for (const [re, ganti] of FRASA) t = t.replace(re, ganti);
  return t.split(/[^a-z0-9]+/).filter(Boolean).map(normKata);
}

/**
 * Satu huruf hilang/berlebih saja ("Brodong" ≡ "Brondong", "Sumberejo" ≡
 * "Sumberrejo"). Huruf TERTUKAR sengaja tidak: "Soekarno" vs "Soekardjo→
 * Soekarjo" dan "Soedono" vs "Soedomo" adalah faskes berbeda.
 */
function sisipSatu(a: string, b: string): boolean {
  const [p, q] = a.length > b.length ? [a, b] : [b, a];
  if (p.length - q.length !== 1) return false;
  for (let i = 0; i < p.length; i++) if (p.slice(0, i) + p.slice(i + 1) === q) return true;
  return false;
}

/** Dua kata dianggap sama: persis, atau sama-sama ≥5 huruf dan beda satu sisipan. */
function kataSama(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && sisipSatu(a, b);
}

const adaDi = (w: string, himp: string[]) => himp.some((x) => kataSama(w, x));

/** Kota boleh beda satu huruf apa pun — salah ketik ada di data Accurate sendiri ("PEMEKASAN"). */
function kotaSama(a: string, b: string): boolean {
  if (kataSama(a, b)) return true;
  if (a.length !== b.length || a.length < 6) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++beda > 1) return false;
  return true;
}
const kotaCocok = (petunjuk: string[], kota: string[]) =>
  kota.length > 0 && petunjuk.every((w) => kota.some((k) => kotaSama(w, k))) && kota.every((k) => petunjuk.some((w) => kotaSama(w, k)));
const semuaAda = (xs: string[], himp: string[]) => xs.every((w) => adaDi(w, himp));

export interface TulisanAm { jenis: Jenis | null; jenis_asli: string | null; kualifikasi: "KOTA" | "KAB" | null; kata: string[] }

/**
 * Bersihkan & urai tulisan AM. null = bukan nama faskes (kosong, potongan
 * hashtag yang ikut tertangkap, dsb.).
 */
export function uraiTulisanAm(teks: string | null | undefined): TulisanAm | null {
  let s = String(teks ?? "").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").trim();
  if (!s || s.includes("#")) return null;
  s = s.replace(/^\s*(cust(omer)?|faskes|instansi|nama|ke)\s*[:.-]\s*/i, "");
  const ws = kataDari(s);
  let jenis: Jenis | null = null;
  let jenis_asli: string | null = null;
  let kualifikasi: "KOTA" | "KAB" | null = null;
  const sisa: string[] = [];
  ws.forEach((w, i) => {
    const j = JENIS_KATA[w];
    // Jenis = kata jenis PERTAMA. Kata jenis berikutnya dibuang (mis. "RSUD dr
    // Soedono": dr di sini gelar, bukan jenis PRIBADI).
    if (j && jenis === null && i <= 1) { jenis = j; jenis_asli = w; return; }
    if (j) return;
    if (KUALIFIKASI[w]) { kualifikasi = KUALIFIKASI[w]; return; }
    if (GELAR.has(w)) return;
    sisa.push(w);
  });
  if (!sisa.length && !jenis) return null;
  return { jenis, jenis_asli, kualifikasi, kata: sisa };
}

export interface FaskesAccurate { id: number; nama: string; jenis: Set<Jenis>; jenis_asli: string[]; nama_kata: string[]; kota_kata: string[]; kualifikasi: "KOTA" | "KAB" | null }

/** Urai nama Accurate: "INTI, JENIS [nama tambahan] KAB./KOTA X" atau "LABKESDA KAB. X". */
export function uraiNamaAccurate(id: number, nama: string): FaskesAccurate {
  const bersih = nama.replace(/^\s*\[merged\]\s*/i, "");
  const koma = bersih.lastIndexOf(",");
  const inti = koma >= 0 ? bersih.slice(0, koma) : "";
  const ekor = koma >= 0 ? bersih.slice(koma + 1) : bersih;
  const we = kataDari(ekor);
  // Kota = sesudah kata KAB/KOTA TERAKHIR (nama tanpa koma: "DINAS KESEHATAN KOTA KEDIRI").
  let k = -1;
  we.forEach((w, i) => { if (KUALIFIKASI[w]) k = i; });
  const tengah = k >= 0 ? we.slice(0, k) : we;
  const kota = k >= 0 ? we.slice(k + 1) : [];
  const kualifikasi = k >= 0 ? KUALIFIKASI[we[k]] : null;
  const jenis = new Set<Jenis>();
  const tambahan: string[] = [];
  // "WAHYU, DR. / DINKES KAB. JOMBANG" = akun pribadi dokter; DR. sesudah koma
  // adalah jenis akun, bukan gelar (di depan nama, "DR. SOEDOMO, RSUD", gelar).
  if (koma >= 0 && ["dr", "drg", "drh"].includes(tengah[0] ?? "")) jenis.add("PRIBADI");
  const jenis_asli: string[] = [];
  for (const w of tengah) {
    const j = JENIS_KATA[w];
    if (j) { jenis.add(j); jenis_asli.push(w); }
    else if (!GELAR.has(w)) tambahan.push(w);
  }
  const nama_kata = [...kataDari(inti).filter((w) => !GELAR.has(w) && !JENIS_KATA[w]), ...tambahan];
  return { id, nama, jenis, jenis_asli, nama_kata, kota_kata: kota, kualifikasi };
}

export type HasilTautan =
  | { kind: "one"; id: number; nama: string; tier: 1 | 2 }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "none" };

function tier(a: TulisanAm, f: FaskesAccurate): 0 | 1 | 2 {
  if (a.jenis && !f.jenis.has(a.jenis)) return 0;
  if (a.kualifikasi && f.kualifikasi && a.kualifikasi !== f.kualifikasi) return 0;
  const A = a.kata;
  const N = f.nama_kata;
  const K = f.kota_kata;
  // Instansi daerah tanpa nama sendiri (LABKESDA/DINKES/PMI KAB. X): kotanya = namanya.
  if (!N.length) {
    if (!a.jenis || !A.length || !K.length) return 0;
    return semuaAda(A, K) && semuaAda(K, A) ? 1 : 0;
  }
  if (!A.length) return 0;
  // Kata yang ditulis rapat/renggang: "Gondanglegi" ≡ "GONDANG LEGI".
  const tanpaKota = A.filter((w) => !adaDi(w, K));
  if (tanpaKota.length && kataSama(tanpaKota.join(""), N.join(""))) return 1;
  const gabungan = [...N, ...K];
  if (!semuaAda(A, gabungan)) return 0;
  // Tier 1: nama Accurate tertulis lengkap (urutan bebas, kota boleh ikut).
  if (semuaAda(N, A)) return 1;
  // Tier 2: AM hanya menulis sebagian nama ("RS Kalikapas" → MUHAMMADIYAH
  // KALIKAPAS, RS). Sah hanya bila: jenisnya disebut, bukan akun pribadi, ada
  // kata NAMA yang khas (bukan kata umum, bukan kota), dan minimal separuh kata
  // nama Accurate tertulis.
  if (!a.jenis || f.jenis.has("PRIBADI")) return 0;
  const cocokNama = N.filter((w) => adaDi(w, A));
  const khas = A.some((w) => adaDi(w, N) && !adaDi(w, K) && !KATA_UMUM.has(w));
  if (khas && cocokNama.length * 2 >= N.length) return 2;
  return 0;
}

/**
 * Pilih satu faskes; dua faskes berbeda sama kuat = ambigu (tidak ditautkan).
 * `kota` (opsional, mis. deal.city) memecah seri antar-kota: "RSUD Haji" +
 * Surabaya → HAJI, RSUD KOTA SURABAYA, bukan Makassar/Batu.
 */
export function tautkanFaskes(teks: string | null | undefined, katalog: FaskesAccurate[], opts: { kota?: string | null } = {}): HasilTautan {
  const a = uraiTulisanAm(teks);
  if (!a) return { kind: "none" };
  const t1: FaskesAccurate[] = [];
  const t2: FaskesAccurate[] = [];
  for (const f of katalog) {
    const t = tier(a, f);
    if (t === 1) t1.push(f);
    else if (t === 2) t2.push(f);
  }
  const pilih = (semua: FaskesAccurate[], tr: 1 | 2): HasilTautan | null => {
    if (!semua.length) return null;
    // "DESY, BU / RS PTP KAB. JEMBER" = akun pribadi orang di RS itu. Bila ada
    // akun faskesnya sendiri, akun pribadi tak ikut bersaing.
    const lembaga = semua.filter((f) => !f.jenis.has("PRIBADI"));
    const xs = lembaga.length ? lembaga : semua;
    // Record kembar (nama sama persis) = satu faskes; ambil id terkecil.
    const grup = new Map<string, FaskesAccurate[]>();
    for (const f of xs) {
      const kunci = f.nama.toUpperCase().replace(/^\s*\[MERGED\]\s*/, "").replace(/[^A-Z0-9]/g, "");
      grup.set(kunci, [...(grup.get(kunci) ?? []), f]);
    }
    let calon = [...grup.values()];
    // Pemecah seri, berurutan; tiap langkah hanya dipakai bila menyisakan ≥1.
    //   1. kota petunjuk (deal.city) — "RS Bhayangkara" + Kediri.
    //   2. jenis persis yang ditulis — "RSUD Jombang" → RSUD, bukan RSI Jombang.
    const kotaPetunjuk = kataDari(opts.kota ?? "").filter((w) => !KUALIFIKASI[w]);
    if (calon.length > 1 && kotaPetunjuk.length) {
      const k = calon.filter((g) => kotaCocok(kotaPetunjuk, g[0].kota_kata));
      if (k.length) calon = k;
    }
    if (calon.length > 1 && a.jenis_asli) {
      const j = calon.filter((g) => g[0].jenis_asli.includes(a.jenis_asli as string));
      if (j.length) calon = j;
    }
    if (calon.length > 1) return { kind: "ambiguous", names: calon.slice(0, 5).map((g) => g[0].nama) };
    const f = calon[0].sort((x, y) => x.id - y.id)[0];
    // Kota petunjuk yang JELAS berbeda = faskes lain bernama sama (cabang jaringan
    // RS, nama umum): "RS Prima Medika" Denpasar ≠ PRIMA MEDIKA, RSU KAB. TULUNGAGUNG.
    if (kotaPetunjuk.length && f.kota_kata.length && !kotaCocok(kotaPetunjuk, f.kota_kata)) return null;
    return { kind: "one", id: f.id, nama: f.nama, tier: tr };
  };
  return pilih(t1, 1) ?? pilih(t2, 2) ?? { kind: "none" };
}

// ── Katalog dari DB (cache singkat: dipakai per pesan #REPORT) ───────────────

let cache: { at: number; rows: FaskesAccurate[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export async function katalogFaskes(): Promise<FaskesAccurate[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await db()`SELECT id, COALESCE(NULLIF(name,''), raw->>'name', '') AS nama FROM accurate_customer`;
  const out = rows.filter((r) => String(r.nama).trim()).map((r) => uraiNamaAccurate(Number(r.id), String(r.nama)));
  cache = { at: Date.now(), rows: out };
  return out;
}

/** account_id untuk satu tulisan AM (+ kota petunjuk bila ada), atau null bila tak yakin. */
export async function accountIdDariTulisan(teks: string | null | undefined, kota?: string | null): Promise<number | null> {
  const h = tautkanFaskes(teks, await katalogFaskes(), { kota });
  return h.kind === "one" ? h.id : null;
}
