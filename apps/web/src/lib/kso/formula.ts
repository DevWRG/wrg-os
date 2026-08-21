// Rumus running cost per test — koefisien teknis dari spec sheet pabrikan.
//
// Disalin apa adanya dari `lib/data.js` aplikasi runningcost-zybio (fungsi
// calc()/det() tiap analyzer). Angka-angka di sini BUKAN data yang di-maintain
// orang non-teknis: mL per test, volume startup/shutdown, siklus cleaning, dan
// faktor waste. Data komersialnya (harga, kemasan, daftar parameter) datang dari
// tabel kso_* lewat /kso/master — lihat komentar migrasi 074 untuk batas antara
// keduanya.
//
// Bentuk umum tiap rumus:
//   D    = test per HARI                      = test/bulan ÷ hari kerja
//   cyc  = biaya reagen yang terpakai per test (ikut jumlah test)
//   fix  = biaya harian (startup + shutdown + cleaning) ÷ D
//          → makin sedikit test/hari, makin mahal per test-nya. Ini yang bikin
//            simulasi ini ada: titik impas KSO ditentukan si `fix`.
//
// JANGAN mengganti literal di sini karena "harga berubah" — harga tidak ada di
// file ini. Yang boleh berubah cuma kalau spec sheet pabrikannya yang berubah.

import type { HargaInput, HasilReagen, KontribusiReagen, KsoAnalyzer } from "./types";

/** Harga nett satu kemasan setelah diskon. */
export const nettOf = (h: HargaInput | undefined): number =>
  h ? h.price * (1 - h.disc / 100) : 0;

/** Harga jual dari biaya pokok + markup. markup ≥ 100% tidak punya arti → 0. */
export const sellOf = (base: number, markup: number): number =>
  markup < 100 ? base / (1 - markup / 100) : 0;

/**
 * Penghitung harga per satuan untuk satu analyzer.
 *
 * `waste` = fraksi isi kemasan yang benar-benar terpakai. Default 1 (semua
 * terpakai); HPLC memakai < 1 karena sisa di dasar botol tidak bisa ditarik.
 */
export function perUnitOf(analyzer: KsoAnalyzer, harga: Record<string, HargaInput>) {
  const byKode = new Map(analyzer.reagents.map((r) => [r.kode, r]));
  const nett = (kode: string): number => {
    const r = byKode.get(kode);
    return nettOf(harga[kode] ?? (r ? { price: r.hargaDp ?? 0, disc: 0 } : undefined));
  };
  return {
    nett,
    /** Harga per mL. Kemasan tanpa volume → 0 (bukan Infinity/NaN). */
    perMl: (kode: string, waste = 1): number => {
      const vol = byKode.get(kode)?.vol ?? 0;
      return vol > 0 ? nett(kode) / (vol * waste) : 0;
    },
    /** Harga per test untuk kemasan yang hasilnya dihitung dalam test. */
    perTest: (kode: string): number => {
      const y = byKode.get(kode)?.yieldTest ?? 0;
      return y > 0 ? nett(kode) / y : 0;
    },
  };
}

export type PerUnit = ReturnType<typeof perUnitOf>;

const kosong = (): HasilReagen => ({ total: 0, cyc: 0, fix: 0, pr: {} });
const jumlah = (pr: Record<string, KontribusiReagen>): HasilReagen => {
  let cyc = 0;
  let fix = 0;
  for (const v of Object.values(pr)) {
    cyc += v.c;
    fix += v.f;
  }
  return { total: cyc + fix, cyc, fix, pr };
};

// ── Hematologi ──────────────────────────────────────────────────────────────

/**
 * Mode test EXZ8000. RET = channel retikulosit ikut dijalankan.
 *
 * `cbc_diff` tidak ada di `testModes` master (master cuma memuat tiga mode yang
 * dipakai untuk kontrol/kalibrasi), tapi layar hasil sumber menawarkannya
 * sebagai pilihan keempat: CBC+DIFF tanpa RET dan tanpa cek control.
 */
export type ExzMode = "cbc_diff" | "cbc_diff_ret" | "cbc_diff_xn" | "cbc_diff_ret_xr";

/**
 * Biaya reagen hematologi per test.
 *
 * @param kode        kode analyzer: Z3 | Z52 | Z50 | EXZ6000 | EXZ8000
 * @param testsPerMonth target test per bulan
 * @param workDays    hari kerja per bulan
 * @param mode        khusus EXZ8000
 */
export function hematoCost(
  kode: string,
  testsPerMonth: number,
  workDays: number,
  u: PerUnit,
  mode: ExzMode = "cbc_diff_ret",
): HasilReagen | null {
  if (!testsPerMonth || !workDays) return null;
  const D = testsPerMonth / workDays;

  switch (kode) {
    case "Z3": {
      const lpm = u.perMl("lyse");
      const dpm = u.perMl("dil");
      const ppm = u.perMl("probe");
      return jumlah({
        lyse: { c: 0.344 * lpm, f: (0.894 * lpm) / D },
        dil: { c: 21.09 * dpm, f: ((77.64 + 59.92) * dpm) / D },
        probe: { c: 0, f: (1 * ppm) / D },
      });
    }

    // Z52 & Z50 memakai set reagen dan koefisien yang sama; yang membedakan
    // cuma harga alatnya (ada di master, bukan di sini).
    case "Z52":
    case "Z50": {
      const dnpm = u.perMl("dn");
      const ldpm = u.perMl("ld");
      const lbpm = u.perMl("lb");
      return jumlah({
        dn: { c: 42.253 * dnpm, f: ((141.674 + 64.972) * dnpm) / D },
        ld: { c: 1.2 * ldpm, f: (2.2 * ldpm) / D },
        lb: { c: 0.205 * lbpm, f: (0.305 * lbpm) / D },
        probe: { c: 0, f: 0 },
      });
    }

    case "EXZ6000": {
      const dnpm = u.perMl("dn");
      const ldipm = u.perMl("ldi");
      const ldiipm = u.perMl("ldii");
      const lbpm = u.perMl("lb");
      const ppm = u.perMl("probe");
      // start + stop + e-sleep (2× siklus tidur) — semuanya harian.
      return jumlah({
        dn: { c: 49.814 * dnpm, f: ((183.40284 + 138.36125 + 2 * 9.405) * dnpm) / D },
        ldi: { c: 0.94 * ldipm, f: ((4.14 + 1.02) * ldipm) / D },
        ldii: { c: 0.45 * ldiipm, f: ((2.8 + 0.15) * ldiipm) / D },
        lb: { c: 0.4 * lbpm, f: ((2.9 + 0.2) * lbpm) / D },
        probe: { c: 0, f: (2 * ppm) / D },
      });
    }

    case "EXZ8000": {
      const dnpm = u.perMl("dn");
      const ldpm = u.perMl("ld");
      const lnpm = u.perMl("ln");
      const fdpm = u.perMl("fd");
      const fnpm = u.perMl("fn");
      const lspm = u.perMl("ls");
      const drpm = u.perMl("dr");
      const frpm = u.perMl("fr");
      const ppm = u.perMl("probe");

      const isRet = mode === "cbc_diff_ret" || mode === "cbc_diff_ret_xr";

      // per test — DN 56 mL saat RET (42 mL channel DIFF + 14 mL channel RET)
      const cc_dn = isRet ? 56 : 42;
      const cc_ld = 1.56;
      const cc_ln = 1.5;
      const cc_fd = 0.02;
      const cc_fn = 0.02;
      const cc_ls = 0.5;
      const cc_dr = isRet ? 1.56 : 0;
      const cc_fr = isRet ? 0.02 : 0;

      // startup & shutdown — harian, tidak ikut jumlah test
      const su_dn = 162, su_ld = 3.06, su_ln = 3.0, su_fd = 0.1, su_fn = 0.08, su_ls = 1.5;
      const su_dr = isRet ? 1.56 : 0;
      const su_fr = 0.02;
      const sd_dn = 140, sd_ld = 0.5, sd_ln = 0.5, sd_fd = 0.02, sd_fn = 0.02, sd_ls = 1.0;
      const sd_dr = 0;
      const sd_fr = 0.006667;

      return jumlah({
        dn: { c: cc_dn * dnpm, f: ((su_dn + sd_dn) * dnpm) / D },
        ld: { c: cc_ld * ldpm, f: ((su_ld + sd_ld) * ldpm) / D },
        ln: { c: cc_ln * lnpm, f: ((su_ln + sd_ln) * lnpm) / D },
        fd: { c: cc_fd * fdpm, f: ((su_fd + sd_fd) * fdpm) / D },
        fn: { c: cc_fn * fnpm, f: ((su_fn + sd_fn) * fnpm) / D },
        ls: { c: cc_ls * lspm, f: ((su_ls + sd_ls) * lspm) / D },
        dr: { c: cc_dr * drpm, f: ((su_dr + sd_dr) * drpm) / D },
        fr: { c: cc_fr * frpm, f: ((su_fr + sd_fr) * frpm) / D },
        probe: { c: 0, f: (3 * ppm) / D },
      });
    }

    default:
      return kosong();
  }
}

// ── Kimia Klinik — detergent ────────────────────────────────────────────────

export interface HasilDetergent {
  total: number;
  conc: number;
  probe: number;
}

/**
 * Biaya detergent Kimia Klinik per test (EXC200 / EXC400).
 *
 * Pemakaian detergent tidak ikut jumlah test, tapi ikut jumlah BATCH
 * pemeriksaan per hari — tiap batch punya siklus cuci sendiri.
 *
 * Catatan yang dipertahankan dari sumber: D di sini SELALU dibagi 30 hari
 * kalender, bukan hari kerja. Itu bukan kelalaian — tabel D2 di file Excel
 * asalnya memang disusun atas dasar 30 hari, dan mengubahnya akan membuat
 * angkanya tidak lagi cocok dengan penawaran yang sudah beredar.
 *
 * @param batch jumlah batch per hari; 0 dianggap 5 (default operasional)
 */
export function ccDetergent(
  kode: string,
  testsPerMonth: number,
  workDays: number,
  concPerMl: number,
  probePerMl: number,
  batch: number,
): HasilDetergent | null {
  if (!testsPerMonth || !workDays) return null;
  const bat = batch > 0 ? batch : 5;
  const D = testsPerMonth / 30;

  // mL detergent per hari: tetap + per-batch + per-test
  const [cd, pd] =
    kode === "EXC400"
      ? [1.2 + 25.4 * bat + 0.2 * D, 4.26 + 4.26 * bat] // 0,71×3×2 + 0,71×3×batch×2
      : [1.68 + 25.88 * bat + 0.28 * D, 2.4 + 3.15 * bat];

  const conc = (cd * concPerMl) / D;
  const probe = (pd * probePerMl) / D;
  return { total: conc + probe, conc, probe };
}

// ── Crossmatch ──────────────────────────────────────────────────────────────

export interface HasilCrossmatch {
  total: number;
  pr: Record<string, number>;
}

/**
 * Biaya crossmatch per test. Tidak punya komponen harian: kartu & LISS habis
 * per pemeriksaan, bukan per hari.
 *
 * @param method metode dari master (`meta.methods`): jumlah kolom kartu + mL LISS
 */
export function crossmatchCost(
  kode: string,
  testsPerMonth: number,
  workDays: number,
  u: PerUnit,
  method: { cols: number; liss_ml: number } | undefined,
): HasilCrossmatch | null {
  if (!testsPerMonth || !workDays || !method) return null;
  // LIBO memakai kartu Coombs (per well), RedCell memakai kartu AHG (per kolom).
  const kartu = kode === "REDCEL" ? "ahg" : "card";
  const kartuCpt = method.cols * u.perMl(kartu);
  const lissCpt = method.liss_ml * u.perMl("liss");
  return { total: kartuCpt + lissCpt, pr: { [kartu]: kartuCpt, liss: lissCpt } };
}

// ── HPLC — HbA1c AH600pro ───────────────────────────────────────────────────

/**
 * Faktor waste buffer HPLC: sisa di dasar botol tidak bisa ditarik jarum.
 * 800 mL efektif 760 (0,95) · 2.000 mL efektif 1.800 (0,90).
 */
const HPLC_WASTE_ELUTION = 0.95;
const HPLC_WASTE_HWS = 0.9;

export function hplcCost(
  testsPerMonth: number,
  workDays: number,
  u: PerUnit,
): HasilReagen | null {
  if (!testsPerMonth || !workDays) return null;
  const D = testsPerMonth / workDays;

  const pel1 = u.perMl("el1", HPLC_WASTE_ELUTION);
  const pel2 = u.perMl("el2", HPLC_WASTE_ELUTION);
  const pel3 = u.perMl("el3", HPLC_WASTE_ELUTION);
  const phws = u.perMl("hws", HPLC_WASTE_HWS);

  const pr: Record<string, KontribusiReagen> = {
    // c = mL per analisis · f = warmup + cleaning 90 menit + wash, harian
    el1: { c: 0.72 * pel1, f: ((3.45 + 1.95 + 1.5) * pel1) / D },
    el2: { c: 0.63 * pel2, f: ((3.45 + 1.95) * pel2) / D },
    el3: { c: 0.15 * pel3, f: ((3.45 + 1.5) * pel3) / D },
    hws: { c: 4.471 * phws, f: ((9.425 + 8.45 + 8.45) * phws) / D },
    // Kolom & filter: aus per test, tidak ada komponen harian.
    col: { c: u.perTest("col"), f: 0 },
    flt: { c: u.perTest("flt"), f: 0 },
  };

  // cyc/fix di sini SENGAJA cuma menjumlah buffer, tidak termasuk kolom &
  // filter — sama seperti sumber, karena yang ditampilkan sebagai "biaya
  // siklus" di layar adalah konsumsi cairan. Keausan kolom/filter tetap masuk
  // `total`, tapi berdiri sendiri sebagai baris depresiasi part.
  const cyc = pr.el1.c + pr.el2.c + pr.el3.c + pr.hws.c;
  const fix = pr.el1.f + pr.el2.f + pr.el3.f + pr.hws.f;
  return { total: cyc + fix + pr.col.c + pr.flt.c, cyc, fix, pr };
}

// ── Elektrolit — DN-X6 ──────────────────────────────────────────────────────

export interface HasilElektrolit {
  /** Berapa hari satu paket reagen bertahan. */
  runDays: number;
  /** Total test yang keluar dari satu paket. */
  totalTests: number;
  /** Biaya per test. */
  cpt: number;
  total: number;
}

/**
 * Elektrolit dihitung terbalik dari kategori lain: yang diketahui adalah isi
 * Cal A per paket, dan pemakaiannya = 21 mL/hari tetap + 0,8 mL per test. Dari
 * situ ketahuan paketnya habis dalam berapa hari, lalu berapa test yang keluar.
 *
 * @param calAVol      isi Cal A (mL) sesuai mode: cartridge 650 · bottle 1.350
 * @param reagentPrice harga nett satu paket reagen mode tsb
 */
export function elektroCost(
  testsPerMonth: number,
  workDays: number,
  calAVol: number,
  reagentPrice: number,
): HasilElektrolit | null {
  if (!testsPerMonth || !workDays || !calAVol) return null;
  const D = testsPerMonth / workDays;
  const runDays = calAVol / (21 + 0.8 * D);
  const totalTests = runDays * D;
  const cpt = totalTests > 0 ? reagentPrice / totalTests : 0;
  return { runDays, totalTests, cpt, total: cpt };
}
