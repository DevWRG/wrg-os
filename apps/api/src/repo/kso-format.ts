// F170 Komite KSO — format WhatsApp #KSO sembilan isian (keputusan product owner 10 Nov 2026).
//
//   #KSO BUDI
//   1. Faskes : RS ABC
//   2. ALAT :  HEMATOLOGY ZYBIO Z50
//   3. TES/Test : 700 TEST/BULAN
//   4. MASA KSO : 36 BULAN
//   5. PERMINTAAN HARGA : 11.800/ TEST
//   6. FEE : 5%
//   7. KOMPETITOR : SYSMEX-XN450-11.500
//   8. KLAUSUL : ADA
//   9. LAMPIRAN : ADA
//
// Semua di berkas ini MURNI (tanpa DB, tanpa LLM) supaya bisa diuji: pengurai label, angka, nama di kepala pesan,
// jabatan pendukung → tipe, pencari alat (cari & rekomendasikan), pencocokan lampiran PDF Simulator CPRR, dan daftar
// "Belum lengkap". Label tak peka huruf besar, urutan bebas, nomor opsional, titik dua opsional.

// ---------------------------------------------------------------- label & angka

export type LabelKso =
  | "faskes" | "alat" | "tes" | "masa" | "harga" | "fee" | "kompetitor" | "klausul" | "lampiran"
  | "pendukung" | "status_unit" | "alasan" | "hari_kerja" | "jumlah" | "sumber" | "kota";

/** Urutan penting: label yang lebih panjang/khusus dicek dulu ("JUMLAH TES" = tes, "JUMLAH" = unit). */
const POLA_LABEL: [LabelKso, RegExp][] = [
  ["status_unit", /^status(?:\s+(?:unit|alat))?\b/i],
  ["hari_kerja", /^hari\s*kerja\b/i],
  ["masa", /^(?:masa(?:\s+kso)?|tenor)\b/i],
  ["harga", /^(?:permintaan\s+harga|harga(?:\s+(?:per\s+)?(?:tes|test))?)\b/i],
  ["tes", /^(?:jumlah\s+)?(?:tes|test|volume)(?:\s*\/\s*(?:tes|test))?\b/i],
  ["faskes", /^(?:nama\s+)?(?:faskes|rumah\s+sakit)\b/i],
  ["alat", /^(?:alat|analy[sz]er)\b/i],
  ["fee", /^fee\b/i],
  ["kompetitor", /^(?:kompetitor|pesaing)\b/i],
  ["klausul", /^klausul\b/i],
  ["lampiran", /^lampiran\b/i],
  ["pendukung", /^pendukung\b/i],
  ["alasan", /^alasan(?:\s+strategis)?\b/i],
  ["jumlah", /^jumlah(?:\s+(?:unit|alat))?\b/i],
  ["sumber", /^(?:sumber|bukti)(?:\s+volume)?\b/i],
  // 303: kota faskes BARU (calon customer) — opsional; faskes master sudah punya cabang/kota
  ["kota", /^(?:kota|kab(?:upaten)?\s*\/\s*kota)\b/i],
];

/** Label tampil (balasan & bantuan). */
export const NAMA_LABEL: Record<LabelKso, string> = {
  faskes: "FASKES", alat: "ALAT", tes: "TES", masa: "MASA KSO", harga: "PERMINTAAN HARGA", fee: "FEE",
  kompetitor: "KOMPETITOR", klausul: "KLAUSUL", lampiran: "LAMPIRAN", pendukung: "PENDUKUNG", status_unit: "STATUS UNIT",
  alasan: "ALASAN", hari_kerja: "HARI KERJA", jumlah: "JUMLAH", sumber: "SUMBER", kota: "KOTA",
};

const NOMOR_BARIS = /^\s*(?:\d{1,2}\s*[.)]|[-•*])\s*/;

/** Satu baris berlabel → [label, nilai]; null bila baris tak diawali label yang dikenal. */
export function bacaBarisLabel(baris: string): [LabelKso, string] | null {
  const t = baris.replace(NOMOR_BARIS, "").trim();
  for (const [k, re] of POLA_LABEL) {
    const m = re.exec(t);
    if (m) return [k, t.slice(m[0].length).replace(/^\s*[:=：]+\s*|^\s+/, "").trim()];
  }
  return null;
}

/**
 * Angka gaya Indonesia: "11.800" = 11800 (titik ribuan), "2,5" = 2.5, "11,8 rb" = 11800, "1,2 jt" = 1200000.
 * Angka pertama di teks; null bila tak ada.
 */
export function angkaId(s: string | null | undefined): number | null {
  const m = /(\d[\d.,]*)(?:\s*(rb|ribu|k|jt|juta)(?![a-z]))?/i.exec(s ?? "");
  if (!m) return null;
  const t = m[1].replace(/[.,]+$/, "");
  const kali = m[2] ? (/^(jt|juta)$/i.test(m[2]) ? 1_000_000 : 1_000) : 1;
  let n: number;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(t) && kali === 1) n = Number(t.replace(/[.,]/g, ""));
  else if (/^\d+[.,]\d+$/.test(t)) n = Number(t.replace(",", "."));
  else n = Number(t.replace(/[.,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * kali * 1000) / 1000;
}

const TIDAK_ADA = /^(?:tidak(?:\s+ada)?|tdk(?:\s+ada)?|tanpa|belum\s+ada|nggak|gak|ga|no|none|nihil|-+|0)\s*\.?$/i;

export interface Kompetitor {
  /** Merek + model apa adanya ("SYSMEX-XN450"); "tidak ada" bila AM menulis tidak ada pesaing. */
  alat: string;
  merek: string | null;
  harga: number | null;
}

/** "SYSMEX-XN450-11.500" → alat SYSMEX-XN450, merek SYSMEX, harga 11.500 (angka harga = angka TERAKHIR). */
export function pisahKompetitor(s: string): Kompetitor | null {
  const t = s.trim();
  if (!t) return null;
  if (TIDAK_ADA.test(t)) return { alat: "tidak ada", merek: null, harga: null };
  // harga di ujung: ribuan bertitik / ≥ 5 digit / 4 digit yang bukan bagian kode model pendek ("BC-5150")
  const m = /(^|[\s\-–—:,@/=(])(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:\/\s*(?:tes|test)|per\s+tes(?:t)?|\))?\s*$/i.exec(t);
  let harga: number | null = null;
  let alat = t;
  if (m) {
    const sebelum = t.slice(0, m.index).replace(/[\s\-–—:,@/=(]+$/, "");
    const tokenSebelum = sebelum.split(/[\s\-–—_/]+/).pop() ?? "";
    const kodePendek = /^\d{4}$/.test(m[2]) && /^[a-z]{1,3}$/i.test(tokenSebelum) && /[-–—]$/.test(t.slice(0, m.index + m[1].length));
    if (!kodePendek && sebelum) {
      harga = angkaId(m[2]);
      alat = sebelum;
    }
  }
  alat = alat.trim();
  const merek = alat.split(/[\s\-–—_/]+/).find((x) => /[a-z]{2,}/i.test(x)) ?? null;
  return { alat, merek: merek ? merek.toUpperCase() : null, harga };
}

export interface Klausul {
  ada: boolean;
  detail: string | null;
}

/** "ADA" / "ADA - minimal volume 500" / "TIDAK" / teks klausul langsung (= ada + detail). */
export function bacaKlausul(s: string): Klausul | null {
  const t = s.trim();
  if (!t) return null;
  if (TIDAK_ADA.test(t) || /^(?:tidak|tdk|tanpa)\b/i.test(t)) return { ada: false, detail: null };
  const m = /^(?:ada|ya|iya|yes)\b[\s:,\-–—()]*/i.exec(t);
  if (m) {
    const d = t.slice(m[0].length).replace(/\)\s*$/, "").trim();
    return { ada: true, detail: d || null };
  }
  return { ada: true, detail: t };
}

/** Detail klausul → kode kso.klausul_khusus. Tak ada yang cocok = 'lainnya' (302; gerbang 7 tetap merah). */
export function kodeKlausul(detail: string): string[] {
  const t = detail.toLowerCase();
  const peta: [string, RegExp][] = [
    ["eksklusivitas", /eksklusi|exclusiv/],
    ["jaminan_volume", /(minimal|minimum|jaminan|garansi)\s+(volume|tes|test|pemakaian)|volume\s+(minimal|minimum)/],
    ["alat_jatuh", /alat\s+(jadi\s+)?(milik|jatuh)|hibah|serah(kan)?\s+alat|milik\s+rs/],
    ["tanpa_eskalasi", /eskalasi|kenaikan\s+harga|harga\s+(tetap|tidak\s+naik|terkunci)/],
    ["tanpa_lapor", /lapor/],
    ["tanpa_denda", /denda/],
    ["draft_rs", /draf|pks\s+(dari|versi|format)\s+rs|format\s+rs/],
  ];
  const kode = peta.filter(([, re]) => re.test(t)).map(([k]) => k);
  return kode.length ? kode : ["lainnya"];
}

const UNIT: [string, RegExp][] = [
  ["eks_kso", /\beks[\s-]*kso\b|\bbekas\s+kso\b/i],
  ["eks_demo", /\beks[\s-]*demo\b|\bbekas\s+demo\b/i],
  ["refurbish", /\brefurb/i],
  ["pinjaman_principal", /\bpinjam/i],
  ["idle", /\bidle\b|\brelokasi\b|\bnganggur/i],
  ["baru", /\bbaru\b|\btambah\s+unit\b/i],
];

/** STATUS UNIT: baru | relokasi idle | eks kso | eks demo | refurbish | pinjaman principal → enum kso.unit_status. */
export function statusUnit(s: string): string | null {
  for (const [k, re] of UNIT) if (re.test(s)) return k;
  return null;
}

// Port deterministik services/ai/app/kso_intake.py _PERAN_KATA (urutan sama: kepala instalasi menang atas dokter).
const PERAN_KATA: [string, RegExp][] = [
  ["kepala_instalasi", /kepala\s+(instalasi|lab(oratorium)?)|ka\.?\s*instalasi|kainst|\bkalab\b/i],
  ["pengadaan", /pengadaan|procurement|\bulp\b|\bppk\b|logistik/i],
  ["manajemen", /direktur|\bdirut\b|wadir|manajemen|kabid|kepala\s+bidang|\bkomite\b/i],
  ["analis_perawat", /analis|perawat|\batlm\b/i],
  ["dokter_user", /dokter|\bdr\.?(?=\s|$)|sp\.?\s*pk|sppk|klinisi/i],
];

/** Jabatan → kso.pendukung_tipe. null bila tak jelas (bot bertanya, tidak menebak). */
export function tipePendukung(jabatan: string): string | null {
  for (const [tipe, re] of PERAN_KATA) if (re.test(jabatan)) return tipe;
  return null;
}

export interface Pendukung {
  nama: string;
  tipe: string | null;
}

/**
 * "dr. X, kepala instalasi lab" → nama dr. X, tipe kepala_instalasi. Jabatan diambil dari bagian SESUDAH pemisah
 * (koma, " - ", "(", " sebagai "); gelar "dr." di depan nama bukan jabatan. Beberapa orang dipisah ";".
 */
export function bacaPendukung(s: string): Pendukung[] {
  return s.split(";").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /\s*(?:,|\s[-–—]\s|\(|\bsebagai\b|:)\s*/i.exec(x);
    if (m && m.index > 0) {
      const nama = x.slice(0, m.index).trim();
      const jabatan = x.slice(m.index + m[0].length).replace(/\)\s*$/, "").trim();
      return { nama, tipe: tipePendukung(jabatan) };
    }
    // tanpa pemisah: jabatan dicari di teks utuh, kecuali gelar di depan nama
    return { nama: x, tipe: tipePendukung(x.replace(/^(?:dr|drg|prof)\.?\s+/i, "")) };
  });
}

// ---------------------------------------------------------------- isian format

export interface IsianFormat {
  faskes?: string;
  alat?: string;
  volume?: number;
  tenor?: number;
  harga?: number;
  fee?: number;
  kompetitor?: Kompetitor;
  klausul?: Klausul;
  lampiran?: boolean | null;
  pendukung: Pendukung[];
  status_unit?: string;
  alasan?: string;
  hari_kerja?: number;
  jumlah?: number;
  sumber?: string;
  /** 303: kota faskes baru (label KOTA:). Tidak masuk isian draft — milik kso.faskes. */
  kota?: string;
  /** Label yang muncul di pesan (nilainya terbaca atau tidak). */
  label: LabelKso[];
  /** Label muncul tapi nilainya tak bisa dibaca → disebut di balasan. */
  tidakTerbaca: { label: LabelKso; nilai: string; sebab: string }[];
  /** Baris tanpa label yang dikenal (bukan kosong). */
  barisAsing: string[];
}

/** Urai baris-baris berlabel. Deterministik — tidak pernah menebak nilai yang tak tertulis. */
export function bacaIsianFormat(teks: string): IsianFormat {
  const x: IsianFormat = { pendukung: [], label: [], tidakTerbaca: [], barisAsing: [] };
  const gagal = (label: LabelKso, nilai: string, sebab: string) => x.tidakTerbaca.push({ label, nilai, sebab });
  for (const baris of teks.split(/\r?\n/)) {
    if (!baris.trim()) continue;
    const lv = bacaBarisLabel(baris);
    if (!lv) {
      x.barisAsing.push(baris.trim());
      continue;
    }
    const [label, v] = lv;
    if (!x.label.includes(label)) x.label.push(label);
    if (!v) {
      gagal(label, v, "kosong");
      continue;
    }
    switch (label) {
      case "faskes": x.faskes = v; break;
      case "alat": x.alat = v; break;
      case "tes": {
        if (/\/\s*hari|per\s+hari|sehari/i.test(v)) { gagal(label, v, "tulis jumlah tes per BULAN"); break; }
        const n = angkaId(v);
        if (n != null && n > 0 && Number.isInteger(n)) x.volume = n; else gagal(label, v, "angka tes per bulan tidak terbaca");
        break;
      }
      case "masa": {
        const n = angkaId(v);
        const bln = n == null ? null : /tahun|thn|th\b/i.test(v) ? n * 12 : n;
        if (bln != null && bln > 0 && Number.isInteger(bln)) x.tenor = bln; else gagal(label, v, "jumlah bulan tidak terbaca");
        break;
      }
      case "harga": {
        const n = angkaId(v);
        if (n != null && n > 0) x.harga = n; else gagal(label, v, "harga per tes tidak terbaca");
        break;
      }
      case "fee": {
        if (TIDAK_ADA.test(v)) { x.fee = 0; break; }
        const n = angkaId(v);
        if (n != null && n >= 0 && n < 100) x.fee = n; else gagal(label, v, "fee harus persen 0–99");
        break;
      }
      case "kompetitor": {
        const k = pisahKompetitor(v);
        if (k) x.kompetitor = k;
        break;
      }
      case "klausul": {
        const k = bacaKlausul(v);
        if (k) x.klausul = k;
        break;
      }
      case "lampiran":
        x.lampiran = /^(?:ada|ya|iya|yes|terlampir)\b/i.test(v) ? true : TIDAK_ADA.test(v) || /^(?:tidak|belum)\b/i.test(v) ? false : null;
        break;
      case "pendukung": x.pendukung.push(...bacaPendukung(v)); break;
      case "status_unit": {
        const u = statusUnit(v);
        if (u) x.status_unit = u; else gagal(label, v, "pilih: baru / relokasi idle / eks kso / eks demo / refurbish / pinjaman principal");
        break;
      }
      case "alasan": x.alasan = v; break;
      case "hari_kerja": {
        const n = angkaId(v);
        if (n != null && Number.isInteger(n) && n >= 1 && n <= 31) x.hari_kerja = n; else gagal(label, v, "hari kerja 1–31 per bulan");
        break;
      }
      case "jumlah": {
        const n = angkaId(v);
        if (n != null && Number.isInteger(n) && n >= 1 && n <= 50) x.jumlah = n; else gagal(label, v, "jumlah unit tidak terbaca");
        break;
      }
      case "sumber": x.sumber = v; break;
      case "kota": x.kota = v; break;
    }
  }
  return x;
}

/** Isian format → p_isian kso.lengkapi_draft (HANYA kunci yang bernilai). Alat & faskes diurus terpisah. */
export function isianLengkapiDariFormat(x: IsianFormat): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (x.volume != null) o.volume_estimasi = x.volume;
  if (x.tenor != null) o.tenor_bulan = x.tenor;
  if (x.harga != null) o.harga_per_test = x.harga;
  if (x.fee != null) o.fee_persen = x.fee;
  if (x.kompetitor) {
    o.kompetitor_alat = x.kompetitor.alat;
    if (x.kompetitor.harga != null) o.harga_pesaing = x.kompetitor.harga;
  }
  if (x.klausul) {
    o.klausul_ada = x.klausul.ada;
    if (!x.klausul.ada) o.klausul = [];
    else if (x.klausul.detail) {
      o.klausul_detail = x.klausul.detail;
      o.klausul = kodeKlausul(x.klausul.detail);
    }
  }
  if (x.status_unit) o.unit_status = x.status_unit;
  if (x.alasan) o.alasan_strategis = x.alasan;
  if (x.hari_kerja != null) o.hari_kerja = x.hari_kerja;
  if (x.jumlah != null) o.jumlah = x.jumlah;
  if (x.sumber) o.volume_sumber = x.sumber;
  const lengkap = x.pendukung.filter((p) => p.tipe);
  if (lengkap.length) o.pendukung = lengkap.map((p) => ({ nama: p.nama, tipe: p.tipe }));
  return o;
}

// ---------------------------------------------------------------- nama di kepala pesan

const SAPAAN = new Set(["pak", "bu", "ibu", "bapak", "mas", "mbak", "mba", "kak", "sdr", "bang", "dr"]);

function tokenNama(s: string | null | undefined): string[] {
  return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !SAPAAN.has(t));
}
const tokenSama = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Nama di "#KSO BUDI" harus nama PENGIRIM: setiap token nama kepala ada di salah satu kandidat (nama AM, panggilan,
 * pushname WA). Tak peka huruf besar, tanda baca dibuang, sapaan (Pak/Bu/Mas) diabaikan, awalan ≥ 4 huruf cukup
 * ("Budi" ~ "Budiz"). Nama kepala kosong = tidak cocok.
 */
export function namaCocok(kepala: string, kandidat: (string | null | undefined)[]): boolean {
  const h = tokenNama(kepala);
  if (!h.length) return false;
  const ks = kandidat.map(tokenNama).filter((k) => k.length);
  return ks.some((k) => h.every((t) => k.some((c) => tokenSama(t, c))) || h.join("") === k.join(""));
}

/** Apakah teks kepala sesudah "#KSO" berbentuk nama orang (bukan kalimat rencana bebas)? */
export function bentukNama(s: string): boolean {
  const t = s.trim();
  return t.length >= 2 && t.length <= 40 && !/\d/.test(t) && /^[\p{L} .'’-]+$/u.test(t) && t.split(/\s+/).length <= 4;
}

// ---------------------------------------------------------------- alat: cari & rekomendasikan

export interface AlatKatalog {
  kode: string;
  nama: string;
  kategori?: string | null;
  /** Label lain dari Simulator (public.kso_analyzer label/brand/pricebook_nama). */
  alias?: string[];
}
export interface SaranAlat {
  kode: string;
  nama: string;
  kategori: string | null;
  skor: number;
}
export type HasilAlat =
  | { kind: "one"; kode: string; nama: string; kategori: string | null; skor: number }
  | { kind: "saran"; ambigu: boolean; saran: SaranAlat[] };

/** Kata kategori/derau yang bukan kode model. Kategori dipakai sebagai petunjuk peringkat. */
const KATEGORI_PETUNJUK: [RegExp, string][] = [
  [/^HEMA(TO(LOGY|LOGI)?)?$|^CBC$/, "HEMA"],
  [/^(KIMIA|CHEM(ISTRY)?|BIOKIMIA)$/, "KIMIA"],
  [/^(IMUN(O|OASAI|OLOGI)?|IMMUNO(ASSAY|LOGY)?|CLIA|ELISA)$/, "IMUN"],
  [/^(ELEKTROLIT|ELECTROLYTE|ELEKTROLYT)$/, "ELEKTROLIT"],
  [/^(BGA|AGD|GAS)$/, "GAS"],
  [/^(URIN(E|ALISA|ALYSIS)?)$/, "URIN"],
  [/^(KOAGULASI|COAG(ULATION)?|HEMOSTASIS)$/, "KOAG"],
  [/^(HEMODIALI[SZ]A|HD)$/, "HEMODIALISA"],
];
const DERAU = new Set(["ANALYZER", "ANALISER", "ANALYSER", "ANALIZER", "ALAT", "MESIN", "AUTO", "AUTOMATIC", "AUTOMATED",
  "OTOMATIS", "UNIT", "BARU", "KSO", "TIPE", "TYPE", "SERI", "SERIES", "DIFF", "PART", "KLINIK", "CLINICAL", "BLOOD",
  "SYSTEM", "SISTEM", "FULLY", "SEMI", "DAN", "ATAU", "THE", "LAB", "LABORATORIUM"]);

function tokenAlat(s: string): string[] {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean)
    // O di dalam kode bercampur angka = nol ("Z5O" → "Z50")
    .map((t) => (/\d/.test(t) && /[A-Z]/.test(t) ? t.replace(/O/g, "0") : t));
}
function petunjukKategori(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) for (const [re, k] of KATEGORI_PETUNJUK) if (re.test(t)) s.add(k);
  return s;
}
function tokenModel(tokens: string[]): string[] {
  return tokens.filter((t) => !DERAU.has(t) && !KATEGORI_PETUNJUK.some(([re]) => re.test(t)) && !/^\d$/.test(t));
}
/** Kandidat kode dari token model: token, gabungan dua token berdekatan ("Z 50", "EXZ 8000", "DN X6"), gabungan semua. */
function kandidatKode(model: string[]): string[] {
  const c = new Set<string>(model);
  for (let i = 0; i + 1 < model.length; i++) {
    const a = model[i], b = model[i + 1];
    if ((/^[A-Z]{1,4}$/.test(a) && /\d/.test(b)) || (/\d/.test(a) && /^[A-Z]{1,3}$/.test(b)) || (a.length <= 3 && b.length <= 3)) c.add(a + b);
  }
  if (model.length) c.add(model.join(""));
  return [...c];
}
/** Kanon OCR: huruf yang sering tertukar dengan angka disamakan (Z→2, S→5, O→0, I/L→1, B→8). */
const kanonOcr = (s: string) => s.replace(/Z/g, "2").replace(/S/g, "5").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/B/g, "8");
const digitDari = (s: string) => (s.match(/\d+/g) ?? []).join("");

export function jarakEdit(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const big = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i + 1 < s.length; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); return m; };
  const x = big(a), y = big(b);
  let sama = 0;
  for (const [k, n] of x) sama += Math.min(n, y.get(k) ?? 0);
  return (2 * sama) / (a.length - 1 + b.length - 1);
}

/** Batas skor "yakin": kode utuh 100, salah baca OCR 90, terkandung 85, merek + angka model 70. */
export const SKOR_YAKIN = 70;

/** Skor satu entri katalog terhadap teks alat. Deterministik. */
export function skorAlat(teks: string, a: AlatKatalog): number {
  const tokens = tokenAlat(teks);
  const model = tokenModel(tokens);
  const cand = kandidatKode(model);
  const gabung = model.join("");
  // kode entri: kode katalog + kode model di nama/alias ("Easy Diagnosis DN-X6" → DNX6)
  const teksEntri = [a.nama, ...(a.alias ?? [])].join(" ");
  const modelEntri = tokenModel(tokenAlat(teksEntri));
  const kodeEntri = new Set<string>([a.kode.toUpperCase().replace(/[^A-Z0-9]/g, "")]);
  for (const k of kandidatKode(modelEntri)) if (/\d/.test(k) && /[A-Z]/.test(k) && k.length >= 2 && k.length <= 10) kodeEntri.add(k);
  let s = 0;
  for (const k of kodeEntri) {
    if (cand.includes(k)) s = Math.max(s, 100);
    else if (/\d/.test(k) && cand.some((c) => /\d/.test(c) && kanonOcr(c) === kanonOcr(k))) s = Math.max(s, 90);
    else if (k.length >= 4 && gabung.includes(k)) s = Math.max(s, 85);
    else if (k.length >= 3 && cand.some((c) => c.length >= 3 && /\d/.test(c) && jarakEdit(c, k) === 1)) s = Math.max(s, 60);
    const dk = digitDari(k);
    if (dk.length >= 2 && model.some((t) => digitDari(t) === dk)) s = Math.max(s, 50);
  }
  // merek/nama: token huruf ≥ 3 dari nama entri yang juga ditulis AM ("ZYBIO")
  const hurufEntri = new Set(modelEntri.filter((t) => /^[A-Z]{3,}$/.test(t) && !kodeEntri.has(t)));
  const merek = model.some((t) => /^[A-Z]{3,}$/.test(t) && hurufEntri.has(t));
  if (merek) s += s > 0 ? 20 : 10;
  const p = petunjukKategori(tokens);
  if (p.size) {
    const kat = tokenAlat(a.kategori ?? "").join(" ");
    if ([...p].some((x) => kat.includes(x))) s += 10;
  }
  return s;
}

/**
 * Cari alat di katalog (format WA dan kolom "analyzer" PDF). Satu entri yakin (≥ 70) dan jelas di atas yang lain
 * → dipakai. Selain itu → 3 saran teratas (kode + nama + kategori) untuk dipilih AM.
 */
export function cariAlat(teks: string, katalog: AlatKatalog[]): HasilAlat {
  const model = tokenModel(tokenAlat(teks)).join("");
  const skor = katalog.map((a) => {
    const s = skorAlat(teks, a);
    // pemeringkat lemah (tak pernah mencapai yakin): kemiripan huruf dengan kode & nama
    const lemah = Math.round(15 * Math.max(dice(model, a.kode.toUpperCase().replace(/[^A-Z0-9]/g, "")),
                                           dice(model, tokenModel(tokenAlat(a.nama)).join(""))));
    return { a, s, urut: s + lemah };
  }).sort((x, y) => y.urut - x.urut || x.a.kode.localeCompare(y.a.kode));
  const yakin = skor.filter((x) => x.s >= SKOR_YAKIN);
  if (yakin.length === 1 || (yakin.length > 1 && yakin[0].s - yakin[1].s >= 30)) {
    const t = yakin[0];
    return { kind: "one", kode: t.a.kode, nama: t.a.nama, kategori: t.a.kategori ?? null, skor: t.s };
  }
  return {
    kind: "saran",
    ambigu: yakin.length > 1,
    saran: skor.filter((x) => x.urut > 0).slice(0, 3)
      .map((x) => ({ kode: x.a.kode, nama: x.a.nama, kategori: x.a.kategori ?? null, skor: x.s })),
  };
}

/** Kecocokan longgar teks alat (mis. OCR PDF "250") dengan alat draft: kode cocok (termasuk salah baca OCR), atau pencarian katalog menunjuk alat itu. */
export function alatCocok(teks: string | null | undefined, kode: string, katalog: AlatKatalog[]): boolean {
  if (!teks?.trim()) return false;
  const a = katalog.find((x) => x.kode === kode) ?? { kode, nama: kode };
  // kode utuh / salah baca OCR / terkandung (≥ 85) cukup; selisih satu karakter + merek (Z52 vs Z50) TIDAK
  if (skorAlat(teks, a) >= 85) return true;
  const h = cariAlat(teks, katalog);
  return h.kind === "one" && h.kode === kode;
}

// ---------------------------------------------------------------- lampiran PDF Simulator CPRR

/** Kontrak services/ai POST /kso/ocr-cprr (isian boleh null semua). */
export interface IsianCprr {
  judul?: string | null;
  tanggal?: string | null;
  nama_sales?: string | null;
  nama_faskes?: string | null;
  kota?: string | null;
  header_mentah?: string | null;
  header_pasti?: boolean | null;
  analyzer?: string | null;
  capex_total?: number | null;
  masa_bulan?: number | null;
  test_per_bulan?: number | null;
  total_target_test?: number | null;
  hari_kerja?: number | null;
  markup_persen?: number | null;
  capex_per_test?: number | null;
  reagen_per_test?: number | null;
  qc_per_test?: number | null;
  base_cost_per_test?: number | null;
  cprr_per_test?: number | null;
  kompetitor_teks?: string | null;
}
export interface HasilOcrCprr {
  ok?: boolean;
  galat?: string | null;
  halaman?: number | null;
  teks_ocr?: string | null;
  peringatan?: string[] | null;
  isian?: IsianCprr | null;
}

export type StatusCocok = "cocok" | "beda" | "kosong";
export interface CocokIsian {
  label: string;
  status: StatusCocok;
  pdf: string | null;
  wa: string | null;
}
export interface HasilCekLampiran {
  lolos: boolean;
  cocok: Record<string, CocokIsian>;
  /** Kalimat per ketidakcocokan (untuk balasan WA). */
  beda: string[];
  /** Info tambahan, bukan penghalang (harga pesaing beda tulis, peringatan hitungan OCR). Tidak dikirim ke AM. */
  info: string[];
  hari_kerja: number | null;
  tanggal: string | null;
}

const GALAT_OCR: Record<string, string> = {
  "dry-run": "pembaca PDF sedang mode uji",
  "pdf-rusak": "berkas PDF rusak / tidak bisa dibuka",
  "bukan-cprr": "PDF bukan cetakan Simulator KSO",
  "cprr-tidak-terbaca": "angka di PDF tidak terbaca — cetak ulang dari Simulator",
};
export function teksGalatOcr(g: string | null | undefined): string {
  return GALAT_OCR[String(g)] ?? "pembaca PDF sedang gangguan — kirim ulang PDF-nya beberapa menit lagi";
}

const STOP_FASKES = new Set(["RS", "RSU", "RSUD", "RSIA", "RSI", "RSAB", "RSK", "RSKIA", "RSB", "RUMAH", "SAKIT", "UMUM", "DAERAH",
  "KLINIK", "PRATAMA", "UTAMA", "LAB", "LABORATORIUM", "PUSKESMAS", "TIPE", "KELAS", "KOTA", "KABUPATEN", "KAB", "SWASTA",
  "IBU", "ANAK", "DAN", "THE", "DR", "HOSPITAL", "MEDIKA", "MEDICAL"]);
function tokenFaskes(s: string | null | undefined): string[] {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP_FASKES.has(t));
}
/** Faskes cocok bila satu token pembeda (selain RS/RSUD/UMUM/…) sama — urutan & penulisan bebas. */
export function faskesCocok(pdf: string | null | undefined, kandidat: (string | null | undefined)[]): boolean {
  const p = tokenFaskes(pdf);
  if (!p.length) return false;
  return kandidat.some((k) => tokenFaskes(k).some((t) => p.some((x) => tokenSama(x.toLowerCase(), t.toLowerCase()))));
}
/** Nama sales cocok bila satu token nama (≥ 3 huruf, bukan sapaan) sama dengan salah satu kandidat nama AM. */
export function salesCocok(pdf: string | null | undefined, kandidat: (string | null | undefined)[]): boolean {
  const p = tokenNama(pdf).filter((t) => t.length >= 3);
  if (!p.length) return false;
  return kandidat.some((k) => tokenNama(k).filter((t) => t.length >= 3).some((t) => p.some((x) => tokenSama(x, t))));
}

export interface DraftUntukLampiran {
  /** Kandidat nama AM: nama di kepala #KSO, nama master, panggilan, pushname. */
  namaAm: (string | null | undefined)[];
  /** Nama faskes master + teks FASKES yang ditulis AM (bila ada). */
  faskes: (string | null | undefined)[];
  alat_kode: string;
  alat_nama: string;
  volume_estimasi: number | null;
  tenor_bulan: number | null;
  kompetitor_alat: string | null;
  harga_pesaing?: number | null;
  harga_per_test: number | null;
}

const rpTeks = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Cocokkan isi PDF Simulator dengan draft. Lolos = semua isian yang dicek cocok. Isian PDF yang tak terbaca (null)
 * atau isian WA yang belum diisi = belum bisa dicocokkan = tidak lolos (disebut di balasan). Peringatan hitungan OCR hanya
 * info. Angka biaya PDF (capex, reagen, QC, base cost, CPRR) TIDAK dibandingkan dan tidak masuk teks apa pun.
 */
export function cocokkanLampiran(h: HasilOcrCprr, d: DraftUntukLampiran, katalog: AlatKatalog[]): HasilCekLampiran {
  const x = h.isian ?? {};
  const info: string[] = [];
  if (!h.ok || !h.isian) {
    return { lolos: false, cocok: {}, beda: [`PDF belum bisa dipakai: ${teksGalatOcr(h.galat)}.`], info, hari_kerja: null, tanggal: null };
  }
  const header = x.header_pasti ? null : x.header_mentah ?? null;
  const cocok: Record<string, CocokIsian> = {};
  const set = (k: string, label: string, ok: boolean | null, pdf: unknown, wa: unknown) => {
    cocok[k] = { label, status: ok == null ? "kosong" : ok ? "cocok" : "beda",
                 pdf: pdf == null || pdf === "" ? null : String(pdf), wa: wa == null || wa === "" ? null : String(wa) };
  };

  const salesPdf = x.header_pasti ? x.nama_sales : header ?? x.nama_sales;
  set("sales", "Nama sales", salesPdf ? salesCocok(salesPdf, d.namaAm) : null, salesPdf, d.namaAm.find(Boolean));
  const faskesPdf = x.header_pasti ? [x.nama_faskes, x.kota].filter(Boolean).join(" ") : header ?? [x.nama_faskes, x.kota].filter(Boolean).join(" ");
  set("faskes", "Faskes", faskesPdf ? faskesCocok(faskesPdf, d.faskes) : null, faskesPdf, d.faskes.find(Boolean));
  set("alat", "Alat", x.analyzer ? alatCocok(x.analyzer, d.alat_kode, katalog) : null, x.analyzer, `${d.alat_kode} (${d.alat_nama})`);
  set("volume", "Tes/bulan", x.test_per_bulan == null || d.volume_estimasi == null ? null : Number(x.test_per_bulan) === d.volume_estimasi,
      x.test_per_bulan, d.volume_estimasi);
  set("tenor", "Masa KSO (bulan)", x.masa_bulan == null || d.tenor_bulan == null ? null : Number(x.masa_bulan) === d.tenor_bulan,
      x.masa_bulan, d.tenor_bulan);
  // kompetitor: merek yang ditulis AM harus muncul di PDF (teks OCR mentah — dibandingkan per token, bukan utuh)
  const tanpaPesaing = !d.kompetitor_alat || /^tidak ada$/i.test(d.kompetitor_alat);
  const merek = tanpaPesaing ? null : pisahKompetitor(d.kompetitor_alat!)?.merek ?? null;
  if (tanpaPesaing) {
    set("kompetitor", "Kompetitor", d.kompetitor_alat ? true : null, x.kompetitor_teks, d.kompetitor_alat);
  } else {
    const tPdf = tokenAlat(x.kompetitor_teks ?? "");
    set("kompetitor", "Kompetitor", x.kompetitor_teks ? !!merek && tPdf.some((t) => tokenSama(t.toLowerCase(), merek.toLowerCase())) : null,
        x.kompetitor_teks, d.kompetitor_alat);
    const hp = d.harga_pesaing;
    if (hp != null && x.kompetitor_teks && !digitDari(x.kompetitor_teks).includes(String(Math.round(hp))))
      info.push(`Harga pesaing di PDF ("${x.kompetitor_teks}") tidak sama persis dengan ${rpTeks(hp)} — periksa.`);
  }

  // 10 Nov (product owner): perbandingan CPRR vs permintaan harga = angka HPP → tidak lagi disusun (balasan ke AM).
  for (const p of h.peringatan ?? []) info.push(`Catatan baca PDF: ${p}`);

  const beda: string[] = [];
  for (const c of Object.values(cocok)) {
    if (c.status === "beda") beda.push(`${c.label}: PDF "${c.pdf ?? "-"}" ≠ WA "${c.wa ?? "-"}"`);
    else if (c.status === "kosong")
      beda.push(c.pdf == null ? `${c.label}: tidak terbaca di PDF` : `${c.label}: belum diisi di WA (PDF "${c.pdf}")`);
  }
  const hk = x.hari_kerja != null && Number.isInteger(Number(x.hari_kerja)) && Number(x.hari_kerja) >= 1 && Number(x.hari_kerja) <= 31
    ? Number(x.hari_kerja) : null;
  return { lolos: beda.length === 0, cocok, beda, info, hari_kerja: hk, tanggal: x.tanggal ?? null };
}

/** Kalimat ketidakcocokan dari kolom `cocok` yang tersimpan (balasan ulang & layar). */
export function bedaDariCocok(cocok: Record<string, CocokIsian> | null | undefined): string[] {
  return Object.values(cocok ?? {}).filter((c) => c.status !== "cocok").map((c) =>
    c.status === "beda" ? `${c.label}: PDF "${c.pdf ?? "-"}" ≠ WA "${c.wa ?? "-"}"`
      : c.pdf == null ? `${c.label}: tidak terbaca di PDF` : `${c.label}: belum diisi di WA (PDF "${c.pdf}")`);
}

// ---------------------------------------------------------------- yang masih kurang

export interface DataKurang {
  volume_estimasi: number | null;
  tenor_bulan: number | null;
  harga_per_test: number | null;
  fee_persen?: number | null;
  kolom_dinyatakan: string[];
  klausul_ada?: boolean | null;
  klausul_detail?: string | null;
  pendukung: { nama: string; tipe: string }[];
  unit_status: string | null;
  volume_sumber: string | null;
  zona_dasar: string | null;
  alasan_strategis?: string | null;
  angka?: { hd: boolean } | null;
  lampiran?: { lolos: boolean; cocok?: Record<string, CocokIsian> | null; galat?: string | null } | null;
}
export interface ItemKurang {
  kunci: string;
  teks: string;
  /** Contoh balasan siap salin, mis. "#KSO D62 FEE: 5%". */
  contoh: string;
}

/**
 * Daftar "Belum lengkap" — sembilan isian + pendukung + status unit + bukti volume + alasan strategis (zona Direktur)
 * + detail klausul (KLAUSUL: ADA) + lampiran PDF cocok. SATU sumber untuk balasan WA, gerbang auto-kirim, dan dashboard.
 */
export function daftarKurang(d: DataKurang, ref: string): ItemKurang[] {
  const q: ItemKurang[] = [];
  const t = (kunci: string, teks: string, contoh: string) => q.push({ kunci, teks, contoh: `#KSO ${ref} ${contoh}` });
  if (d.volume_estimasi == null) t("tes", "TES — jumlah tes per bulan", "TES: 700");
  if (d.tenor_bulan == null) t("masa", "MASA KSO — berapa bulan", "MASA KSO: 36");
  if (d.harga_per_test == null) t("harga", "PERMINTAAN HARGA per tes", "PERMINTAAN HARGA: 11.800");
  if (d.fee_persen == null) t("fee", "FEE ke RS/perantara (tulis 0 bila tidak ada)", "FEE: 5%");
  if (!d.kolom_dinyatakan.includes("kompetitor_alat")) t("kompetitor", "KOMPETITOR — merek-model-harga (atau TIDAK ADA)", "KOMPETITOR: MEREK-MODEL-11.500");
  if (!d.kolom_dinyatakan.includes("klausul")) {
    if (d.klausul_ada === true && !d.klausul_detail) t("klausul", "Detail KLAUSUL dari RS (KLAUSUL: ADA belum ada isinya)", "KLAUSUL: ADA - minimal volume 500");
    else t("klausul", "KLAUSUL — ADA (sebut isinya) atau TIDAK", "KLAUSUL: TIDAK");
  }
  // Contoh lampiran bukan baris berlabel: PDF dikirim sebagai berkas, captionnya "#KSO <ref>".
  if (!d.lampiran)
    q.push({
      kunci: "lampiran",
      teks: "LAMPIRAN — PDF Simulator KSO kirim di chat ini, sekaligus bukti volume",
      contoh: `kirim PDF Simulator di chat ini dengan caption #KSO ${ref}`,
    });
  else if (!d.lampiran.lolos) {
    const b = d.lampiran.galat ? [teksGalatOcr(d.lampiran.galat)] : bedaDariCocok(d.lampiran.cocok);
    t("lampiran", `LAMPIRAN PDF belum cocok${b.length ? `: ${b.join("; ")}` : ""}`, "LABEL: ISI YANG BENAR, atau kirim ulang PDF");
  }
  if (d.pendukung.length === 0) t("pendukung", "PENDUKUNG di RS — nama + jabatan", "PENDUKUNG: dr. Contoh, kepala instalasi lab");
  if (!d.unit_status) t("status_unit", "STATUS UNIT — baru / relokasi idle / eks kso / eks demo / refurbish / pinjaman principal", "STATUS UNIT: baru");
  if (!d.volume_sumber?.trim() && d.lampiran?.lolos) t("sumber", "SUMBER volume (bukti tertulis)", "SUMBER: rekap LIS 3 bulan");
  if (d.zona_dasar === "direktur" && !d.angka?.hd && !d.alasan_strategis?.trim())
    // teks tanpa margin: daftar ini juga dikirim ke AM (keputusan 10 Nov)
    t("alasan", "ALASAN strategis — diperlukan untuk usulan ini", "ALASAN: referensi wilayah");
  return q;
}

// ---------------------------------------------------------------- 303: faskes — pasti / pilih / faskes baru

export interface FaskesKatalog {
  id: string;
  nama: string;
  cabang?: string | null;
  kota?: string | null;
  /** Faskes SEMENTARA (calon customer) yang dibuat dari #KSO sebelumnya — id BARU-<n>. */
  baru?: boolean;
}
export interface SaranFaskes {
  id: string;
  nama: string;
  cabang: string | null;
  baru: boolean;
  skor: number;
}
export type HasilFaskes =
  | { kind: "one"; id: string; nama: string; baru: boolean }
  | { kind: "saran"; saran: SaranFaskes[] }
  | { kind: "baru" };

/** Skor "mirip" (0–1) di atas batas ini = ditawarkan sebagai pilihan, bukan langsung dibuat faskes baru. */
export const SKOR_FASKES_MIRIP = 0.5;

const normFaskes = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Kemiripan nama faskes yang DITULIS AM dengan satu nama faskes (master / faskes baru). Kata generik (RS, RSUD,
 * KLINIK, KOTA, …) dibuang dulu. Skor = maks(kemiripan huruf inti, porsi kata inti AM yang ada di nama itu × 0,9);
 * kata ≥ 4 huruf dengan selisih satu huruf dihitung sama (salah ketik "KELURGA" ~ "KELUARGA").
 */
export function skorFaskes(teks: string, nama: string): number {
  const q = tokenFaskes(teks);
  const c = [...new Set(tokenFaskes(nama))];
  if (!q.length || !c.length) return 0;
  const sama = (a: string, b: string) => tokenSama(a.toLowerCase(), b.toLowerCase()) || (a.length >= 4 && b.length >= 4 && jarakEdit(a, b) === 1);
  const cakup = q.filter((t) => c.some((x) => sama(t, x))).length / q.length;
  const d = dice(q.join(""), c.join(""));
  return Math.round(Math.max(d, cakup * 0.9) * 100) / 100;
}

/**
 * Keputusan faskes untuk usulan #KSO baru (keputusan product owner 10 Nov: faskes boleh customer baru):
 *   - `yakin` (cariAkun menunjuk tepat satu faskes master) atau nama persis sama (huruf/tanda baca diabaikan)
 *     dengan tepat satu faskes → "one";
 *   - ada yang mirip (skor ≥ SKOR_FASKES_MIRIP, atau nama yang disebut cariAkun ambigu) → "saran" (maks 3) —
 *     AM memilih nomor atau FASKES BARU; tidak pernah membuat faskes kembar diam-diam;
 *   - tidak ada yang mirip → "baru" (faskes sementara dibuat).
 */
export function putuskanFaskes(
  teks: string, katalog: FaskesKatalog[], o: { yakin?: { id: string; nama: string } | null; ambigu?: string[] } = {},
): HasilFaskes {
  if (o.yakin) {
    const f = katalog.find((x) => x.id === o.yakin!.id);
    return { kind: "one", id: o.yakin.id, nama: f?.nama ?? o.yakin.nama, baru: !!f?.baru };
  }
  const n = normFaskes(teks);
  const persis = katalog.filter((x) => n && normFaskes(x.nama) === n);
  if (persis.length === 1) return { kind: "one", id: persis[0].id, nama: persis[0].nama, baru: !!persis[0].baru };
  const ambigu = new Set((o.ambigu ?? []).map(normFaskes));
  const saran = katalog
    .map((x) => {
      const s = skorFaskes(teks, x.nama);
      return { x, skor: ambigu.has(normFaskes(x.nama)) || persis.includes(x) ? Math.max(s, 1) : s };
    })
    .filter((y) => y.skor >= SKOR_FASKES_MIRIP)
    .sort((a, b) => b.skor - a.skor || a.x.nama.localeCompare(b.x.nama))
    .slice(0, 3)
    .map(({ x, skor }) => ({ id: x.id, nama: x.nama, cabang: x.cabang ?? null, baru: !!x.baru, skor }));
  return saran.length ? { kind: "saran", saran } : { kind: "baru" };
}

/** Isian "#KSO FASKES …" untuk usulan tertunda: nomor pilihan, FASKES BARU, atau nama yang ditulis ulang. */
export type PilihanFaskes = { kind: "nomor"; n: number } | { kind: "baru" } | { kind: "nama"; nama: string };
export function bacaPilihanFaskes(v: string): PilihanFaskes {
  const t = v.trim();
  const m = /^(\d)\s*\.?$/.exec(t);
  if (m) return { kind: "nomor", n: Number(m[1]) };
  if (/^(?:baru|faskes\s+baru|customer\s+baru|calon\s+customer)\b\s*\.?$/i.test(t)) return { kind: "baru" };
  return { kind: "nama", nama: t };
}
