// Model turunan Simulator KSO: dari input layar → angka yang ditampilkan.
//
// Dipisah dari komponen supaya rumus bisnisnya bisa dibaca (dan diuji) tanpa
// menembus JSX. formula.ts memegang koefisien mesin; file ini memegang cara
// biaya disusun jadi harga: CAPEX per test, overhead QC/kalibrasi, lalu markup.
//
// Semua fungsi murni — tidak ada state, tidak ada fetch.

import {
  ccDetergent, hematoCost, nettOf, perUnitOf, sellOf,
  type ExzMode, type PerUnit,
} from "./formula";
import type { HargaInput, HasilReagen, KsoAnalyzer, KsoParameter } from "./types";

export { nettOf, sellOf };

// ── CAPEX ───────────────────────────────────────────────────────────────────

export interface CapexInput {
  /** Analyzer utama. */
  harga: HargaInput;
  ups: number;
  lis: number;
  /** Analyzer cadangan, kalau faskes minta ada backup. */
  backup: HargaInput | null;
  /** Lama kontrak KSO, bulan. */
  ksoBulan: number;
  /** Target test per bulan. */
  testsPerMonth: number;
  workDays: number;
}

export interface Capex {
  nettAlat: number;
  nettBackup: number;
  total: number;
  /** Total test sepanjang kontrak = bulan × test/bulan. */
  totalTest: number;
  /** CAPEX dibagi seluruh test kontrak. */
  perTest: number;
  /** Test per hari. */
  D: number;
}

export function hitungCapex(i: CapexInput): Capex {
  const nettAlat = nettOf(i.harga);
  const nettBackup = i.backup ? nettOf(i.backup) : 0;
  const total = nettAlat + i.ups + i.lis + nettBackup;
  const totalTest = i.ksoBulan * i.testsPerMonth;
  return {
    nettAlat,
    nettBackup,
    total,
    totalTest,
    perTest: totalTest > 0 ? total / totalTest : 0,
    D: i.workDays > 0 ? i.testsPerMonth / i.workDays : 0,
  };
}

// ── Hematologi ──────────────────────────────────────────────────────────────

/**
 * Kontrol & kalibrator hematologi.
 *
 * `free` = vendor menanggung materialnya, tapi RUN-nya tetap memakai reagen —
 * itu yang dibebankan ke harga per test. `false` (beli) = tidak dibebankan ke
 * test sama sekali, faskes membelinya terpisah.
 */
export interface KontrolInput {
  free: boolean;
  /** Berapa run QC per hari. */
  nQc: number;
  /** Berapa kali kalibrasi per bulan (EXZ8000: per 25 hari). */
  nCal: number;
  ctrl: HargaInput;
  cal: HargaInput;
}

/**
 * Overhead kontrol + kalibrasi per test.
 *
 * EXZ8000 dihitung atas dasar 25 hari, bukan hari kerja yang diinput: siklus
 * QC/kalibrasi alat ini memang disusun per 25 hari di manualnya. Dua rumus ini
 * dipertahankan terpisah persis seperti sumber.
 */
export function overheadKontrol(
  kodeAnalyzer: string,
  hasil: HasilReagen | null,
  kontrol: KontrolInput,
  testsPerMonth: number,
  workDays: number,
  D: number,
  exzMode: ExzMode,
): number {
  if (!hasil || D <= 0 || !kontrol.free) return 0;
  const nettCtrl = nettOf(kontrol.ctrl);
  const nettCal = nettOf(kontrol.cal);

  if (kodeAnalyzer === "EXZ8000") {
    // Hanya mode yang memang menjalankan Check XN/XR yang kena overhead.
    if (exzMode !== "cbc_diff_xn" && exzMode !== "cbc_diff_ret_xr") return 0;
    const tests25 = D * 25;
    if (tests25 <= 0) return 0;
    const qcReagen = kontrol.nQc * 25 * hasil.cyc;
    const calReagen = kontrol.nCal * hasil.cyc;
    return (nettCtrl + qcReagen + nettCal + calReagen) / tests25;
  }

  if (testsPerMonth <= 0) return 0;
  const qcReagen = kontrol.nQc * workDays * hasil.cyc;
  const calReagen = kontrol.nCal * hasil.cyc;
  return (nettCtrl + qcReagen + nettCal + calReagen) / testsPerMonth;
}

export interface BarisReagenHemato {
  kode: string;
  nama: string;
  pack: string | null;
  nettKit: number;
  /** Biaya reagen ini per test (siklus + porsi harian). */
  kontribusiTest: number;
  /**
   * Harga jual per kemasan yang harus diketik ke file Excel running cost
   * pabrikan supaya hasil Excel-nya sama dengan angka KSO CPRR di layar ini.
   * Bukan harga jual yang ditawarkan ke faskes.
   */
  hargaExcel: number;
}

export interface HasilHemato {
  reagen: HasilReagen | null;
  rows: BarisReagenHemato[];
  /** Total biaya reagen per test. */
  reagenPerTest: number;
  overheadKontrol: number;
  /** CAPEX + reagen + overhead, sebelum markup. */
  baseCost: number;
  /** Harga jual per test setelah markup. */
  sellPerTest: number;
  perUnit: PerUnit;
}

export function hitungHemato(
  analyzer: KsoAnalyzer,
  harga: Record<string, HargaInput>,
  capex: Capex,
  testsPerMonth: number,
  workDays: number,
  markup: number,
  kontrol: KontrolInput,
  exzMode: ExzMode,
): HasilHemato {
  const perUnit = perUnitOf(analyzer, harga);
  const reagen = hematoCost(analyzer.kode, testsPerMonth, workDays, perUnit, exzMode);
  const reagenPerTest = reagen?.total ?? 0;
  const oh = overheadKontrol(
    analyzer.kode, reagen, kontrol, testsPerMonth, workDays, capex.D, exzMode,
  );
  const baseCost = capex.perTest + reagenPerTest + oh;
  const sellPerTest = sellOf(baseCost, markup);

  const rows = analyzer.reagents
    .filter((r) => r.jenis === "reagent" || r.jenis === "consumable")
    .map((r) => {
      const nettKit = nettOf(harga[r.kode]);
      const pr = reagen?.pr[r.kode];
      const kontribusiTest = pr ? pr.c + pr.f : 0;
      return {
        kode: r.kode,
        nama: r.nama,
        pack: r.pack,
        nettKit,
        kontribusiTest,
        // Proporsi kontribusi reagen ini terhadap total, dikalikan harga jual.
        hargaExcel: reagenPerTest > 0 && sellPerTest > 0 ? (nettKit * sellPerTest) / reagenPerTest : 0,
      };
    });

  return { reagen, rows, reagenPerTest, overheadKontrol: oh, baseCost, sellPerTest, perUnit };
}

// ── Kimia Klinik ────────────────────────────────────────────────────────────

/** Satu baris parameter di layar — master + angka yang boleh diubah user. */
export interface ParamKk {
  id: string;
  nama: string;
  panel: string;
  pack: string | null;
  testsPerKit: number;
  price: number;
  disc: number;
  /** Vendor menanggung (khusus panel Control). */
  free: boolean;
  /** Ditambahkan user di layar, bukan dari master. */
  custom: boolean;
  /** Baris kalibrator — overhead-nya dihitung per bulan, bukan per hari. */
  kalibrator: boolean;
}

export const PANEL_CONTROL = "Control";
export const PANEL_CONSUMABLE = "Consumable";

/** Ubah baris master jadi baris layar dengan nilai awal. */
export function paramKkAwal(rows: KsoParameter[]): ParamKk[] {
  return rows.map((p) => ({
    id: `cc_${p.no}`,
    nama: p.nama,
    panel: p.panel ?? "",
    pack: p.pack,
    testsPerKit: p.testsPerKit ?? 0,
    price: p.hargaPl ?? p.hargaDp ?? 0,
    disc: 0,
    free: p.panel === PANEL_CONTROL,
    custom: false,
    kalibrator: p.flags?.kalibrator === true,
  }));
}

export interface BarisParamKk {
  nama: string;
  panel: string;
  pack: string | null;
  testsPerKit: number;
  /** Harga jual per test, dibulatkan ke atas kelipatan Rp 100. */
  sellTest: number;
  sellKit: number;
}

export interface HasilKk {
  /** Biaya detergent per test (hasil det(), sadar-batch). */
  consumablePerTest: number;
  /** Rincian detergent per item consumable. */
  consumable: { nama: string; perTest: number }[];
  qcPerTest: number;
  calPerTest: number;
  overheadTotal: number;
  adaOverhead: boolean;
  /** CAPEX + consumable + overhead — belum termasuk reagen parameternya. */
  bebanTetap: number;
  /** Rata-rata biaya reagen per test dari seluruh parameter reguler. */
  avgReagenPerTest: number;
  avgBaseCost: number;
  /** Rata-rata harga jual per test (kelipatan Rp 100). */
  avgSellPerTest: number;
  rows: BarisParamKk[];
  /** Jumlah parameter reguler (bukan Control / Consumable). */
  jumlahParameter: number;
}

const bulatRatus = (v: number): number => Math.ceil(v / 100) * 100;
const cptOf = (p: ParamKk): number =>
  p.testsPerKit > 0 ? (p.price * (1 - p.disc / 100)) / p.testsPerKit : 0;

/**
 * Model biaya Kimia Klinik.
 *
 * Bedanya dengan hematologi: satu sampel bisa diperiksa untuk banyak parameter,
 * dan tiap parameter reagennya beda harga. Jadi yang punya arti bukan "biaya per
 * test" tunggal, melainkan beban tetap per sampel (alat + detergent + QC) yang
 * ditanggung SEMUA parameter, ditambah reagen parameter yang bersangkutan.
 *
 * @param nParam jumlah parameter yang dijalankan per sampel — dipakai menghitung
 *               reagen yang habis untuk tiap run QC.
 */
export function hitungKk(
  kodeAnalyzer: string,
  params: ParamKk[],
  capex: Capex,
  testsPerMonth: number,
  workDays: number,
  batch: number,
  markup: number,
  nQcPerHari: number,
  nCalPerBulan: number,
): HasilKk {
  const consumables = params.filter((p) => p.panel === PANEL_CONSUMABLE);
  const conc = consumables[0];
  const probe = consumables[1];

  // det() minta harga per mL; kemasan detergent memang tetap (20 L & 240 mL),
  // jadi volumenya ikut baris consumable di master lewat testsPerKit? Tidak —
  // detergent tidak punya "test per kit", volumenya yang menentukan. Nilai mL
  // dipegang di sini karena cuma dua baris dan keduanya bagian dari rumus det().
  const VOL_CONC = 20000;
  const VOL_PROBE = 240;
  const det =
    testsPerMonth > 0
      ? ccDetergent(
          kodeAnalyzer, testsPerMonth, workDays,
          conc ? (conc.price * (1 - conc.disc / 100)) / VOL_CONC : 0,
          probe ? (probe.price * (1 - probe.disc / 100)) / VOL_PROBE : 0,
          batch,
        )
      : null;
  const consumablePerTest = det?.total ?? 0;

  const reguler = params.filter(
    (p) => p.panel !== PANEL_CONTROL && p.panel !== PANEL_CONSUMABLE,
  );
  const jumlahParameter = reguler.length;
  const avgReagenPerTest =
    reguler.length > 0 ? reguler.reduce((s, p) => s + cptOf(p), 0) / reguler.length : 0;
  // Reagen yang habis untuk satu run yang memeriksa seluruh parameter.
  const reagenPerRun = avgReagenPerTest * jumlahParameter;

  const kontrolFree = params.filter((p) => p.panel === PANEL_CONTROL && p.free);
  const kalibrator = kontrolFree.find((p) => p.kalibrator);
  const vialKontrol = kontrolFree.filter((p) => !p.kalibrator);

  // QC: material vial + reagen yang terpakai run QC, dibagi test sebulan.
  const testsPerPeriode = capex.D * workDays;
  const nettVial = vialKontrol.reduce((s, p) => s + p.price * (1 - p.disc / 100), 0);
  const qcPerTest =
    testsPerPeriode > 0 ? (reagenPerRun * nQcPerHari * workDays + nettVial) / testsPerPeriode : 0;

  // Kalibrasi: dihitung per bulan (frekuensinya bulanan, bukan harian).
  const calPerKit = kalibrator
    ? (kalibrator.price * (1 - kalibrator.disc / 100)) / Math.max(kalibrator.testsPerKit, 1)
    : 0;
  const calPerTest =
    testsPerMonth > 0 ? (reagenPerRun * nCalPerBulan + calPerKit * nCalPerBulan) / testsPerMonth : 0;

  const adaOverhead = kontrolFree.length > 0 && capex.D > 0;
  const overheadTotal = adaOverhead ? qcPerTest + calPerTest : 0;
  const bebanTetap = capex.perTest + consumablePerTest + overheadTotal;

  const avgBaseCost = bebanTetap + avgReagenPerTest;
  const avgSellPerTest = bulatRatus(sellOf(avgBaseCost, markup));

  // Kontrol yang free tidak muncul sebagai baris jual — biayanya sudah larut
  // ke overhead; menampilkannya lagi = dihitung dua kali.
  const rows = params
    .filter((p) => !(p.panel === PANEL_CONTROL && p.free) && p.panel !== PANEL_CONSUMABLE)
    .map((p) => {
      const base = bebanTetap + cptOf(p);
      const sellTest = bulatRatus(sellOf(base, markup));
      return {
        nama: p.nama,
        panel: p.panel,
        pack: p.pack,
        testsPerKit: p.testsPerKit,
        sellTest,
        sellKit: sellTest * p.testsPerKit,
      };
    });

  return {
    consumablePerTest,
    consumable: [
      ...(conc ? [{ nama: conc.nama, perTest: det?.conc ?? 0 }] : []),
      ...(probe ? [{ nama: probe.nama, perTest: det?.probe ?? 0 }] : []),
    ],
    qcPerTest,
    calPerTest,
    overheadTotal,
    adaOverhead,
    bebanTetap,
    avgReagenPerTest,
    avgBaseCost,
    avgSellPerTest,
    rows,
    jumlahParameter,
  };
}
