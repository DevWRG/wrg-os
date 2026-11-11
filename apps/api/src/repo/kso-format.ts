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
  // "NAMA CUSTOMER ; RS X" / "NAMA RS: X" / "CUSTOMER: X" (varian pesan AM 10 Nov) — "RS" saja BUKAN label
  ["faskes", /^(?:nama\s+(?:faskes|customer|pelanggan|rs|rumah\s+sakit)|faskes|rumah\s+sakit|customer)\b/i],
  ["alat", /^(?:nama\s+)?(?:alat|analy[sz]er)\b/i],
  ["fee", /^fee\b/i],
  ["kompetitor", /^(?:kompetitor|pesaing)\b/i],
  ["klausul", /^klausul\b/i],
  ["lampiran", /^lampiran\b/i],
  ["pendukung", /^pendukung\b/i],
  ["alasan", /^alasan(?:\s+strategis)?\b/i],
  ["jumlah", /^jumlah(?:\s+(?:unit|alat))?\b/i],
  ["sumber", /^(?:sumber|bukti)(?:\s+volume)?\b/i],
  // 303/304: kota faskes BARU (calon customer) — TIDAK ditanyakan lagi (default area AM, 304), tapi tetap diterima diam-diam
  ["kota", /^(?:kota|kab(?:upaten)?\s*\/\s*kota)\b/i],
];

/** Label tampil (balasan & bantuan). */
export const NAMA_LABEL: Record<LabelKso, string> = {
  faskes: "FASKES", alat: "ALAT", tes: "TES", masa: "MASA KSO", harga: "PERMINTAAN HARGA", fee: "FEE",
  kompetitor: "KOMPETITOR", klausul: "KLAUSUL", lampiran: "LAMPIRAN", pendukung: "PENDUKUNG", status_unit: "STATUS UNIT",
  alasan: "ALASAN", hari_kerja: "HARI KERJA", jumlah: "JUMLAH", sumber: "BUKTI VOLUME", kota: "KOTA",
};

const NOMOR_BARIS = /^\s*(?:\d{1,2}\s*[.)]|[-•*])\s*/;

/** Satu baris berlabel → [label, nilai]; null bila baris tak diawali label yang dikenal. */
export function bacaBarisLabel(baris: string): [LabelKso, string] | null {
  const t = baris.replace(NOMOR_BARIS, "").trim();
  for (const [k, re] of POLA_LABEL) {
    const m = re.exec(t);
    // pemisah ":" "=" ";" (spasi bebas), atau " - " tanpa titik dua ("KOMPETITOR : -" tetap bernilai "-")
    if (m) return [k, t.slice(m[0].length).replace(/^\s*[:=：;]+\s*|^\s+[-–—]\s+|^\s+/, "").trim()];
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

/** Pemisah PILIHAN di templat ("BARU / RELOKASI IDLE / …") dan "atau". Koma/"dan" = beberapa hal sekaligus, bukan pilihan. */
const PISAH_PILIHAN = /\s*(?:\/|\||\batau\b)\s*/i;

/**
 * Nilai yang MENDAFTAR beberapa pilihan berbeda (templat ditempel apa adanya) → true. Bot tak boleh memilih sendiri.
 * "rekap LIS / SIMRS" = satu jenis → bukan daftar pilihan.
 */
export function daftarPilihan(s: string, jenis: (bagian: string) => string | null): boolean {
  const k = new Set(s.split(PISAH_PILIHAN).map(jenis).filter(Boolean));
  return k.size > 1;
}

/** Jenis bukti volume yang diterima Pedoman (selaras kso.tebak_label_sumber 266) — hanya untuk mendeteksi daftar pilihan. */
export function jenisBuktiVolume(s: string): string | null {
  if (/\bsurat\b/i.test(s)) return "surat";
  if (/\b(?:pembelian|beli|reagen|faktur|invoice|nota|po)\b/i.test(s)) return "pembelian";
  if (/\b(?:lis|simrs|sim|rekap|rekapan|laporan|log|logbook|sistem|register)\b/i.test(s)) return "lis";
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
  /** 303: kota faskes baru (label KOTA:, opsional — tak ditanyakan; default area AM, 304). Milik kso.faskes. */
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
      case "pendukung":
        // templat ditempel apa adanya ("dr. NAMA, JABATAN") → tidak dicatat sebagai orang
        if (/\b(?:nama|jabatan)\b/i.test(v)) gagal(label, v, "tulis nama dan jabatan pendukung yang sebenarnya");
        else x.pendukung.push(...bacaPendukung(v));
        break;
      case "status_unit": {
        const u = daftarPilihan(v, statusUnit) ? null : statusUnit(v);
        if (u) x.status_unit = u; else gagal(label, v, "pilih SATU: baru / relokasi idle / eks kso / eks demo / refurbish / pinjaman principal");
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
      case "sumber":
        if (daftarPilihan(v, jenisBuktiVolume)) gagal(label, v, "pilih SATU: rekap LIS 6 bulan / pembelian reagen / surat RS");
        else x.sumber = v;
        break;
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
 * Kanon salah baca OCR untuk NAMA (huruf kecil): rn→m, q→g, 0→o, 1/l/i→l, 5→s. Dipakai HANYA pencocokan silang PDF
 * Simulator (nama sales & faskes), bukan pencocokan faskes master. Kasus prod 10 Nov: huruf q terbaca g ("BUDIQ" ~ "Budig").
 */
const kanonOcrNama = (s: string) => s.replace(/rn/g, "m").replace(/q/g, "g").replace(/0/g, "o").replace(/[1i]/g, "l").replace(/5/g, "s");
/** Token OCR sama: sama/awalan (tokenSama), atau ≥ 4 huruf dengan selisih satu karakter / sama sesudah kanon OCR. */
export function tokenMiripOcr(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (tokenSama(x, y)) return true;
  if (Math.min(x.length, y.length) < 4) return false;
  const kx = kanonOcrNama(x), ky = kanonOcrNama(y);
  return tokenSama(kx, ky) || jarakEdit(x, y) <= 1 || jarakEdit(kx, ky) <= 1;
}
/** Token nama untuk pencocokan OCR: huruf + angka (angka bisa salah baca huruf), sapaan dibuang. */
function tokenNamaOcr(s: string | null | undefined): string[] {
  return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 3 && /[a-z]/.test(t) && !SAPAAN.has(t));
}

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

/**
 * Kata kategori/derau yang bukan kode model. Kategori dipakai sebagai petunjuk peringkat: [kata yang ditulis AM,
 * kunci, token kategori katalog yang sepadan]. Kategori katalog prod = kode Simulator (HEMATO, CC, CLIA, ELEKTRO, BG,
 * …), bukan kata Indonesia — "KIMIA KLINIK" harus menunjuk CC.
 */
const KATEGORI_PETUNJUK: [RegExp, string, RegExp][] = [
  [/^HEMA(TO(LOGY|LOGI)?)?$|^CBC$/, "HEMA", /^HEMA/],
  [/^(KIMIA|CHEM(ISTRY)?|BIOKIMIA)$/, "KIMIA", /^(KIMIA|CC|CHEM|BIOKIMIA)/],
  [/^(IMUN(O|OASAI|OLOGI)?|IMMUNO(ASSAY|LOGY)?|CLIA|ELISA)$/, "IMUN", /^(IMUN|IMMUN|CLIA|ELISA)/],
  [/^(ELEKTROLIT|ELECTROLYTE|ELEKTROLYT)$/, "ELEKTROLIT", /^(ELEKTRO|ELECTRO)/],
  [/^(BGA|AGD|GAS)$/, "GAS", /^(BG|BGA|AGD|GAS)$/],
  [/^(URIN(E|ALISA|ALYSIS)?)$/, "URIN", /^URIN/],
  [/^(KOAGULASI|COAG(ULATION)?|HEMOSTASIS)$/, "KOAG", /^(KOAG|COAG|HEMOSTA)/],
  [/^(HEMODIALI[SZ]A|HD)$/, "HEMODIALISA", /^(HEMODIAL|HD)$/],
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
/** Kategori katalog ("CC", "Kimia klinik", "HEMATO") sepadan dengan salah satu petunjuk? */
function kategoriSepadan(petunjuk: Set<string>, kategori: string | null | undefined): boolean {
  const tk = tokenAlat(kategori ?? "");
  return KATEGORI_PETUNJUK.some(([, k, kat]) => petunjuk.has(k) && tk.some((t) => kat.test(t)));
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
  return nilaiAlat(teks, a).s;
}

/**
 * Skor + bukti. bukti = ada dasar nyata untuk MENAWARKAN entri ini sebagai saran: kode model mirip (salah baca OCR /
 * terkandung / selisih satu huruf, skor kode ≥ 60) atau merek yang sama. Kemiripan huruf lemah, angka model yang
 * kebetulan sama ("CM 250" ↔ Z50) atau kategori saja BUKAN bukti — alat merek lain jangan disarankan (307: dicatat
 * sebagai alat baru).
 */
function nilaiAlat(teks: string, a: AlatKatalog): { s: number; bukti: boolean } {
  const tokens = tokenAlat(teks);
  const model = tokenModel(tokens);
  const cand = kandidatKode(model);
  const gabung = model.join("");
  // angka murni yang didahului huruf kode ("CM 250") = kode model alat itu sendiri, bukan salah baca OCR "Z50" → 250.
  // OCR PDF "250" (tanpa huruf di depan) tetap boleh dibaca sebagai Z50.
  const angkaBerawalan = new Set(model.filter((t, i) => /^\d+$/.test(t) && i > 0 && /^[A-Z]{1,4}$/.test(model[i - 1])));
  const ocrBoleh = (c: string) => /\d/.test(c) && !angkaBerawalan.has(c);
  // kode entri: kode katalog + kode model di nama/alias ("Easy Diagnosis DN-X6" → DNX6)
  const teksEntri = [a.nama, ...(a.alias ?? [])].join(" ");
  const modelEntri = tokenModel(tokenAlat(teksEntri));
  const kodeEntri = new Set<string>([a.kode.toUpperCase().replace(/[^A-Z0-9]/g, "")]);
  for (const k of kandidatKode(modelEntri)) if (/\d/.test(k) && /[A-Z]/.test(k) && k.length >= 2 && k.length <= 10) kodeEntri.add(k);
  let s = 0;
  for (const k of kodeEntri) {
    if (cand.includes(k)) s = Math.max(s, 100);
    else if (/\d/.test(k) && cand.some((c) => ocrBoleh(c) && kanonOcr(c) === kanonOcr(k))) s = Math.max(s, 90);
    else if (k.length >= 4 && gabung.includes(k)) s = Math.max(s, 85);
    else if (k.length >= 3 && cand.some((c) => c.length >= 3 && ocrBoleh(c) && jarakEdit(c, k) === 1)) s = Math.max(s, 60);
    const dk = digitDari(k);
    if (dk.length >= 2 && model.some((t) => digitDari(t) === dk)) s = Math.max(s, 50);
  }
  // merek/nama: token huruf ≥ 3 dari nama entri yang juga ditulis AM ("ZYBIO")
  const hurufEntri = new Set(modelEntri.filter((t) => /^[A-Z]{3,}$/.test(t) && !kodeEntri.has(t)));
  const merek = model.some((t) => /^[A-Z]{3,}$/.test(t) && hurufEntri.has(t));
  let bukti = s >= 60 || merek;
  // kode yang ditulis AM = AWAL kode katalog ("ZYBIO Z 5" → Z50/Z52): angka tunggal ikut dihitung di sini (tokenModel
  // membuangnya), nama katalog sering hanya kode tanpa merek. Bukti saran saja (40 < yakin), bukan tebakan.
  const kodeAm = kandidatKode(tokens.filter((t) => !DERAU.has(t) && !KATEGORI_PETUNJUK.some(([re]) => re.test(t))))
    .filter((c) => c.length >= 2 && /\d/.test(c) && /[A-Z]/.test(c));
  for (const k of kodeEntri)
    if (kodeAm.some((c) => k !== c && k.startsWith(c) && k.length - c.length <= 2)) { s = Math.max(s, 40); bukti = true; }
  if (merek) s += s > 0 ? 20 : 10;
  const p = petunjukKategori(tokens);
  if (p.size && a.kategori) {
    // kategori saja jadi bukti hanya bila AM tak menulis merek/model apa pun ("hematologi 5 diff")
    if (kategoriSepadan(p, a.kategori)) { s += 10; if (!model.length) bukti = true; }
    // kategori yang ditulis AM bertentangan dengan kategori entri: kecocokan tak utuh (OCR/selisih huruf/angka model)
    // tidak boleh "yakin" — "KIMIA … 250" bukan Z50 hematologi. Kode utuh (100) tetap menang.
    else if (s < 100) { s = Math.min(s, 5); bukti = false; }
  }
  return { s, bukti };
}

/**
 * Cari alat di katalog (format WA dan kolom "analyzer" PDF). Satu entri yakin (≥ 70) dan jelas di atas yang lain
 * → dipakai. Selain itu → 3 saran teratas (kode + nama + kategori) untuk dipilih AM.
 */
export function cariAlat(teks: string, katalog: AlatKatalog[]): HasilAlat {
  const model = tokenModel(tokenAlat(teks)).join("");
  const skor = katalog.map((a) => {
    const { s, bukti } = nilaiAlat(teks, a);
    // pemeringkat lemah (tak pernah mencapai yakin): kemiripan huruf dengan kode & nama
    const lemah = Math.round(15 * Math.max(dice(model, a.kode.toUpperCase().replace(/[^A-Z0-9]/g, "")),
                                           dice(model, tokenModel(tokenAlat(a.nama)).join(""))));
    return { a, s, bukti, urut: s + lemah };
  }).sort((x, y) => y.urut - x.urut || x.a.kode.localeCompare(y.a.kode));
  const yakin = skor.filter((x) => x.s >= SKOR_YAKIN);
  if (yakin.length === 1 || (yakin.length > 1 && yakin[0].s - yakin[1].s >= 30)) {
    const t = yakin[0];
    return { kind: "one", kode: t.a.kode, nama: t.a.nama, kategori: t.a.kategori ?? null, skor: t.s };
  }
  return {
    kind: "saran",
    ambigu: yakin.length > 1,
    // 307: hanya yang punya bukti (kode mirip / merek sama); tanpa bukti → saran kosong → dicatat alat baru
    saran: skor.filter((x) => x.bukti && x.urut > 0).slice(0, 3)
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
  /** Alat: kode katalog yang ditunjuk teks OCR PDF (cariAlat "one"); dipakai di balasan, bukan teks OCR mentah. */
  pdf_kode?: string | null;
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
/**
 * Jenis faskes yang tertulis: "rs" (RS/RSUD/RSIA/…/RUMAH SAKIT), "pkm" (PKM/PUSKESMAS/PUSTU), "klinik", "lab"; null bila
 * tak tertulis. Kata jenis dibuang dari token pembanding (STOP_FASKES / tak membedakan), jadi tanpa ini "RSUD X" dan
 * "X, PKM KAB. Y" seri dan yang menang nama yang lebih pendek — kasus prod 10 Nov: RSUD ditawari PKM bernama sama.
 */
export function jenisFaskes(s: string | null | undefined): "rs" | "pkm" | "klinik" | "lab" | null {
  const t = String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(/\s+/);
  if (t.some((x) => /^RS[A-Z]{0,4}$/.test(x)) || /\bRUMAH SAKIT\b/.test(t.join(" "))) return "rs";
  if (t.some((x) => x === "PKM" || x === "PUSKESMAS" || x === "PUSTU")) return "pkm";
  if (t.includes("KLINIK")) return "klinik";
  if (t.some((x) => x === "LAB" || x === "LABORATORIUM")) return "lab";
  return null;
}
/** Kedua nama menyebut jenis faskes yang dikenali (jenisFaskes) dan jenisnya berbeda. */
export function jenisBeda(a: string | null | undefined, b: string | null | undefined): boolean {
  const ja = jenisFaskes(a), jb = jenisFaskes(b);
  return !!ja && !!jb && ja !== jb;
}
function tokenFaskes(s: string | null | undefined): string[] {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP_FASKES.has(t));
}
/**
 * Faskes PDF cocok bila satu token pembeda (selain RS/RSUD/UMUM/…) sama — urutan & penulisan bebas; salah baca OCR satu
 * karakter (≥ 4 huruf) dan kekeliruan OCR umum (q/g, 0/o, 1/l/i, 5/s, rn/m) dimaafkan (tokenMiripOcr).
 */
export function faskesCocok(pdf: string | null | undefined, kandidat: (string | null | undefined)[]): boolean {
  const p = tokenFaskes(pdf);
  if (!p.length) return false;
  return kandidat.some((k) => tokenFaskes(k).some((t) => p.some((x) => tokenMiripOcr(x, t))));
}
/**
 * Nama sales PDF cocok bila satu token nama (≥ 3 huruf, bukan sapaan) sama dengan salah satu kandidat nama AM —
 * toleran salah baca OCR (tokenMiripOcr): "Budig" ~ "BUDIQ", "Rina5" ~ "RINAS".
 */
export function salesCocok(pdf: string | null | undefined, kandidat: (string | null | undefined)[]): boolean {
  const p = tokenNamaOcr(pdf);
  if (!p.length) return false;
  return kandidat.some((k) => tokenNamaOcr(k).some((t) => p.some((x) => tokenMiripOcr(x, t))));
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
  if (x.analyzer) {
    const ka = cariAlat(x.analyzer, katalog);
    cocok.alat.pdf_kode = ka.kind === "one" ? ka.kode : null;
  }
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

  const beda = bedaDariCocok(cocok);
  const hk = x.hari_kerja != null && Number.isInteger(Number(x.hari_kerja)) && Number(x.hari_kerja) >= 1 && Number(x.hari_kerja) <= 31
    ? Number(x.hari_kerja) : null;
  return { lolos: beda.length === 0, cocok, beda, info, hari_kerja: hk, tanggal: x.tanggal ?? null };
}

/** Kalimat ketidakcocokan dari kolom `cocok` yang tersimpan (balasan ulang & layar). */
export function bedaDariCocok(cocok: Record<string, CocokIsian> | null | undefined): string[] {
  return Object.entries(cocok ?? {}).filter(([, c]) => c.status !== "cocok").map(([k, c]) => {
    // alat: kode katalog hasil baca PDF, bukan teks OCR mentah ("EXC200 =")
    const pdf = k === "alat" && c.pdf != null ? c.pdf_kode ?? "tidak jelas" : c.pdf;
    return c.status === "beda" ? `${c.label}: PDF "${pdf ?? "-"}" ≠ WA "${c.wa ?? "-"}"`
      : c.pdf == null ? `${c.label}: tidak terbaca di PDF` : `${c.label}: belum diisi di WA (PDF "${pdf}")`;
  });
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
  /** 307: alat baru → zona Direktur karena data alat, bukan margin — ALASAN strategis tidak diminta. */
  alat_baru?: boolean | null;
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
  if (!d.volume_sumber?.trim() && d.lampiran?.lolos)
    t("sumber", "BUKTI VOLUME — rekap LIS 6 bulan / pembelian reagen / surat RS", "BUKTI VOLUME: rekap LIS 6 bulan");
  if (d.zona_dasar === "direktur" && !d.angka?.hd && !d.alat_baru && !d.alasan_strategis?.trim())
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
  /** SATU calon terbaik untuk dikonfirmasi AM (#KSO YA / TIDAK). Baris tertunda lama (sebelum 10 Nov malam) bisa berisi 3. */
  | { kind: "saran"; saran: SaranFaskes[] }
  | { kind: "baru" };

/** Skor "mirip" (0–1) di atas batas ini = ditanyakan konfirmasi (YA/TIDAK), bukan langsung dibuat faskes baru. */
export const SKOR_FASKES_MIRIP = 0.5;

const normFaskes = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const ROMAWI = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]);
/** Kunci angka pembeda di nama faskes (urut, digabung) — angka arab & romawi berdiri sendiri. */
export function angkaPembeda(s: string): string {
  return normFaskes(s).split(" ").filter((w) => /^\d+$/.test(w) || ROMAWI.has(w)).map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w)).join(",");
}

/**
 * Kemiripan nama faskes yang DITULIS AM dengan satu nama faskes (master / faskes baru). Kata generik (RS, RSUD,
 * KLINIK, KOTA, …) dibuang dulu. Skor = maks(kemiripan huruf inti, porsi kata inti AM yang ada di nama itu × 0,9);
 * kata ≥ 4 huruf dengan selisih satu huruf dihitung sama (salah ketik "KELURGA" ~ "KELUARGA").
 */
export function skorFaskes(teks: string, nama: string): number {
  // Angka pembeda (arab atau romawi) yang berbeda = faskes lain, bukan salah ketik: "RS UJI COBA 2" ≠ "RS UJI COBA",
  // "PUSKESMAS X I" ≠ "PUSKESMAS X II". Uji dev 10 Nov: tanpa ini AM yang menulis faskes baru bernomor ditawari
  // faskes lama tanpa nomor.
  if (angkaPembeda(teks) !== angkaPembeda(nama)) return 0;
  // Jenis faskes yang tertulis di KEDUA sisi dan berbeda (RSUD vs PKM, RS vs klinik) = faskes lain walau nama intinya
  // sama — kasus prod 10 Nov: "X, RSUD KAB. Y" ditawari "X, PKM KAB. Y". Salah satu tanpa jenis → seperti biasa.
  if (jenisBeda(teks, nama)) return 0;
  const q = tokenFaskes(teks);
  const c = [...new Set(tokenFaskes(nama))];
  if (!q.length || !c.length) return 0;
  const sama = (a: string, b: string) => tokenSama(a.toLowerCase(), b.toLowerCase()) || (a.length >= 4 && b.length >= 4 && jarakEdit(a, b) === 1);
  const cakup = q.filter((t) => c.some((x) => sama(t, x))).length / q.length;
  const d = dice(q.join(""), c.join(""));
  return Math.round(Math.max(d, cakup * 0.9) * 100) / 100;
}

/** Semua kata inti yang DITULIS AM (termasuk kota, mis. "KOTA CONTOH") ada di nama faskes itu (salah ketik 1 huruf boleh). */
export function semuaKataFaskes(teks: string, nama: string): boolean {
  const q = tokenFaskes(teks);
  const c = tokenFaskes(nama);
  const sama = (a: string, b: string) => tokenSama(a.toLowerCase(), b.toLowerCase()) || (a.length >= 4 && b.length >= 4 && jarakEdit(a, b) === 1);
  return q.length > 0 && q.every((t) => c.some((x) => sama(t, x)));
}

export interface OpsiFaskes {
  /** cariAkun menunjuk tepat satu faskes master. */
  yakin?: { id: string; nama: string } | null;
  /** Nama yang disebut cariAkun ambigu — ikut DIPERINGKAT (skor sebenarnya), bukan disamaratakan. */
  ambigu?: string[];
  /** Cabang AM pengirim — pemutus seri. */
  cabangAm?: string | null;
}

/**
 * Peringkat SEMUA calon faskes yang masuk akal (skor ≥ SKOR_FASKES_MIRIP, atau disebut ambigu oleh cariAkun).
 * Urutan deterministik: memuat semua kata inti yang ditulis AM (termasuk kota) → jenis faskes sama dengan yang ditulis AM
 * (RS/RSUD vs PKM vs klinik vs lab) → skor → cabang sama dengan AM →
 * nama lebih pendek → abjad. Contoh: "RS PKU X KOTAB" menang atas "PKU X KOTAA, RS" walau keduanya disebut ambigu.
 */
export function peringkatFaskes(teks: string, katalog: FaskesKatalog[], o: OpsiFaskes = {}): SaranFaskes[] {
  const ambigu = new Set((o.ambigu ?? []).map(normFaskes));
  const cab = normFaskes(o.cabangAm);
  const jenisAm = jenisFaskes(teks);
  return katalog
    .map((x) => ({ x, skor: skorFaskes(teks, x.nama), semua: semuaKataFaskes(teks, x.nama), cabang: !!cab && normFaskes(x.cabang) === cab,
                   jenis: !!jenisAm && jenisFaskes(x.nama) === jenisAm }))
    .filter((y) => y.skor >= SKOR_FASKES_MIRIP
      || (ambigu.has(normFaskes(y.x.nama)) && angkaPembeda(teks) === angkaPembeda(y.x.nama) && !jenisBeda(teks, y.x.nama)))
    .sort((a, b) => Number(b.semua) - Number(a.semua) || Number(b.jenis) - Number(a.jenis) || b.skor - a.skor || Number(b.cabang) - Number(a.cabang)
      || a.x.nama.length - b.x.nama.length || a.x.nama.localeCompare(b.x.nama))
    .map(({ x, skor }) => ({ id: x.id, nama: x.nama, cabang: x.cabang ?? null, baru: !!x.baru, skor }));
}

/**
 * Keputusan faskes untuk usulan #KSO baru (keputusan product owner 10 Nov: "bot yang mencocokkan nama customer,
 * AM hanya konfirmasi ya atau tidak"):
 *   - `yakin` (cariAkun menunjuk tepat satu faskes master) atau nama persis sama (huruf/tanda baca diabaikan)
 *     dengan tepat satu faskes → "one" (dipakai tanpa bertanya);
 *   - ada calon yang masuk akal → "saran" berisi SATU calon terbaik (peringkatFaskes) — AM menjawab #KSO YA / TIDAK;
 *     tidak pernah daftar, tidak pernah membuat faskes kembar diam-diam;
 *   - tidak ada yang mirip → "baru" (faskes sementara dibuat).
 */
export function putuskanFaskes(teks: string, katalog: FaskesKatalog[], o: OpsiFaskes = {}): HasilFaskes {
  const n = normFaskes(teks);
  // "Persis" = sama sesudah huruf/tanda baca diabaikan, terhadap nama master ATAU bentuk tampilnya (nama Accurate
  // terbalik "INTI, JENIS KOTA"). Hanya itu yang dipakai tanpa bertanya — keputusan pemilik 10 Nov: bot yang
  // mencocokkan, AM cukup konfirmasi YA/TIDAK.
  const samaPersis = (nama: string) => !!n && (normFaskes(nama) === n || normFaskes(namaTampilFaskes(nama)) === n);
  // cariAkun menunjuk satu akun yang jenisnya beda dengan yang ditulis AM (RSUD vs PKM) → bukan calon; diputus peringkat biasa
  const yakinNama = o.yakin ? katalog.find((x) => x.id === o.yakin!.id)?.nama ?? o.yakin.nama : null;
  if (o.yakin && !jenisBeda(teks, yakinNama)) {
    const f = katalog.find((x) => x.id === o.yakin!.id);
    const nama = f?.nama ?? o.yakin.nama;
    if (samaPersis(nama)) return { kind: "one", id: o.yakin.id, nama, baru: !!f?.baru };
    // cariAkun menunjuk satu akun, tapi nama yang ditulis tidak persis sama (uji dev 10 Nov: "…01A06B" langsung
    // dipakai sebagai "…01A068") → tetap ditanyakan YA/TIDAK.
    return { kind: "saran", saran: [{ id: o.yakin.id, nama, cabang: f?.cabang ?? null, baru: !!f?.baru, skor: skorFaskes(teks, nama) }] };
  }
  const persis = katalog.filter((x) => samaPersis(x.nama));
  if (persis.length === 1) return { kind: "one", id: persis[0].id, nama: persis[0].nama, baru: !!persis[0].baru };
  const urut = peringkatFaskes(teks, katalog, o);
  return urut.length ? { kind: "saran", saran: urut.slice(0, 1) } : { kind: "baru" };
}

const JENIS_FASKES = /^(?:RS\w*|RUMAH\s+SAKIT|KLINIK|PUSKESMAS|LAB(?:ORATORIUM)?|UTD|BALAI|APOTEK|PT|CV)\b/i;
const PENANDA_KOTA = /(?:^|\s)((?:KOTA|KAB(?:UPATEN)?\.?)\s+.+)$/i;

/**
 * Nama faskes yang enak dibaca. Nama master Accurate sering terbalik "INTI, JENIS KOTA" ("SEJAHTERA, RS UMUM KAB.
 * CONTOH") → "RS UMUM SEJAHTERA (KAB. CONTOH)". Pola tak berlaku (tanpa koma, bagian sesudah koma bukan jenis faskes
 * atau kota) → apa adanya.
 */
export function namaTampilFaskes(nama: string): string {
  const t = nama.trim().replace(/\s+/g, " ");
  const i = t.indexOf(",");
  if (i <= 0 || t.indexOf(",", i + 1) >= 0) return t;
  const inti = t.slice(0, i).trim();
  const belakang = t.slice(i + 1).trim();
  if (!inti || !belakang) return t;
  const mk = PENANDA_KOTA.exec(belakang);
  const kota = mk ? mk[1].trim() : null;
  const jenis = (mk ? belakang.slice(0, mk.index) : belakang).trim();
  if (jenis && !JENIS_FASKES.test(jenis)) return t;
  if (!jenis && !kota) return t;
  return `${jenis ? `${jenis} ` : ""}${inti}${kota ? ` (${kota})` : ""}`;
}

/** Jawaban konfirmasi "#KSO YA" / "#KSO TIDAK" (dan variannya). null = bukan jawaban ya/tidak. */
export function bacaYaTidak(s: string): "ya" | "tidak" | null {
  const t = s.trim().replace(/[.!]+$/, "").trim();
  if (/^(?:ya|y|iya|iyo|yes|benar|betul|bener)$/i.test(t)) return "ya";
  if (/^(?:tidak|t|tdk|bukan|no|enggak|nggak|gak)$/i.test(t)) return "tidak";
  return null;
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
