// Tipe master Simulator KSO — bentuknya sama persis dengan payload
// apps/api /kso/master (repo/kso.ts). Sengaja dideklarasikan ulang di sisi web
// dan tidak diimpor dari @wrg/types: ini kontrak satu endpoint untuk satu menu,
// bukan tipe domain yang dipakai banyak tempat.

export type KsoKategori = "HEMATO" | "CC" | "XM" | "CLIA" | "HPLC" | "ELEKTRO" | "BG";
export type KsoJenisReagen = "reagent" | "consumable" | "cartridge" | "qc";
export type KsoGrupParameter = "CC" | "SNIBE" | "WONDFO";

export interface KsoReagent {
  kode: string;
  jenis: KsoJenisReagen;
  nama: string;
  pack: string | null;
  /** Isi kemasan dalam mL — reagen cair. Kosong untuk kit/cartridge. */
  vol: number | null;
  /** Hasil kemasan dalam test — kit/cartridge. Kosong untuk reagen cair. */
  yieldTest: number | null;
  hargaDp: number | null;
  hargaPl: number | null;
  flags: Record<string, unknown>;
}

export interface KsoAnalyzer {
  kategori: KsoKategori;
  /** Kunci yang mengikat ke rumus di formula.ts — bukan sekadar label. */
  kode: string;
  label: string;
  brand: string | null;
  defaultCapex: number;
  defaultCapexPl: number | null;
  defaultDisc: number;
  defaultKsoBulan: number;
  defaultMarkup: number;
  defaultTests: number;
  presets: number[];
  meta: KsoMeta;
  reagents: KsoReagent[];
}

/** Atribut khusus per kategori (kolom `meta` jsonb) — semuanya opsional. */
export interface KsoMeta {
  diff?: string;                       // hematologi: 3-Diff / 5-Diff / 6-Diff
  ctrlPl?: number | null;
  calPl?: number | null;
  xnCtrlPl?: number | null;            // EXZ8000
  xrCtrlPl?: number | null;            // EXZ8000
  testModes?: { id: string; label: string; short: string }[];
  methods?: { id: string; label: string; cols: number; liss_ml: number }[];
  modes?: Record<string, { label: string; calAVol: number; price: number }>;
  stability?: number;                  // blood gas: masa pakai cartridge (hari)
  dMaint?: number;                     // blood gas: biaya maintenance
}

export interface KsoParameter {
  grup: KsoGrupParameter;
  no: number;
  nama: string;
  panel: string | null;
  pack: string | null;
  testsPerKit: number | null;
  hargaDp: number | null;
  hargaPl: number | null;
  flags: Record<string, unknown>;
}

export interface KsoMaster {
  analyzers: KsoAnalyzer[];
  parameters: KsoParameter[];
  panels: { grup: string; nama: string }[];
}

/**
 * Harga yang sedang dipakai user untuk satu reagen. `price` = harga per kemasan
 * (bisa dia timpa saat nego), `disc` = diskon dalam persen.
 */
export interface HargaInput {
  price: number;
  disc: number;
}

/** Kolom hasil per reagen: kontribusi biaya per test, dipecah siklus vs tetap. */
export interface KontribusiReagen {
  /** Terpakai tiap test dijalankan (cycle). */
  c: number;
  /** Terpakai tiap hari (startup/shutdown/cleaning), dibagi rata ke test hari itu. */
  f: number;
}

export interface HasilReagen {
  /** Biaya reagen per test = cyc + fix. */
  total: number;
  cyc: number;
  fix: number;
  pr: Record<string, KontribusiReagen>;
}
