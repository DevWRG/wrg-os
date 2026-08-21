// Master Simulator KSO (tabel kso_analyzer / kso_reagent / kso_parameter /
// kso_panel, migrasi 074). Menu /kso-simulator di apps/web.
//
// Cuma baca. Simulasi itu coret-coretan penawaran di layar sales — angka yang
// dia ubah (harga nego, diskon, jumlah test) TIDAK disimpan balik ke sini;
// tabel ini titik berangkat, bukan penampung hasil.
//
// Satu endpoint mengirim seluruh master sekaligus (±14 analyzer, 55 reagen,
// 386 parameter ≈ 60 KB JSON). Dipecah per-kategori tidak ada gunanya: user
// berpindah tab bolak-balik saat membandingkan skema, dan payload sekecil ini
// lebih murah sekali kirim daripada tujuh kali bolak-balik.

import { db, isDbEnabled } from "../db.js";

export interface KsoReagent {
  kode: string;
  jenis: "reagent" | "consumable" | "cartridge" | "qc";
  nama: string;
  pack: string | null;
  vol: number | null;         // isi kemasan (mL) — reagen cair
  yieldTest: number | null;   // hasil kemasan (test) — kit/cartridge
  hargaDp: number | null;
  hargaPl: number | null;
  flags: Record<string, unknown>;
}

export interface KsoAnalyzer {
  kategori: string;
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
  meta: Record<string, unknown>;
  reagents: KsoReagent[];
}

export interface KsoParameter {
  grup: "CC" | "SNIBE" | "WONDFO";
  no: number;
  nama: string;
  panel: string | null;
  pack: string | null;
  testsPerKit: number | null;
  hargaDp: number | null;
  hargaPl: number | null;
  flags: Record<string, unknown>;
}

export interface KsoPanel {
  grup: string;
  nama: string;
}

export interface KsoMaster {
  analyzers: KsoAnalyzer[];
  parameters: KsoParameter[];
  panels: KsoPanel[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function master(): Promise<KsoMaster> {
  if (!isDbEnabled()) return { analyzers: [], parameters: [], panels: [] };
  const sql = db();

  const [aRows, rRows, pRows, nRows] = await Promise.all([
    sql<Record<string, unknown>[]>`
      SELECT id, kategori, kode, label, brand, default_capex, default_capex_pl,
             default_disc, default_kso_bulan, default_markup, default_tests, presets, meta
        FROM kso_analyzer
       WHERE aktif
       ORDER BY urutan, kategori, kode`,
    sql<Record<string, unknown>[]>`
      SELECT analyzer_id, kode, jenis, nama, pack, vol, yield_test, harga_dp, harga_pl, flags
        FROM kso_reagent
       ORDER BY analyzer_id, urutan, kode`,
    sql<Record<string, unknown>[]>`
      SELECT grup, no, nama, panel, pack, tests_per_kit, harga_dp, harga_pl, flags
        FROM kso_parameter
       WHERE aktif
       ORDER BY grup, no`,
    sql<Record<string, unknown>[]>`SELECT grup, nama FROM kso_panel ORDER BY grup, urutan, nama`,
  ]);

  const perAnalyzer = new Map<number, KsoReagent[]>();
  for (const r of rRows) {
    const id = Number(r.analyzer_id);
    const list = perAnalyzer.get(id) ?? [];
    list.push({
      kode: String(r.kode),
      jenis: r.jenis as KsoReagent["jenis"],
      nama: String(r.nama),
      pack: (r.pack as string) ?? null,
      vol: numOrNull(r.vol),
      yieldTest: numOrNull(r.yield_test),
      hargaDp: numOrNull(r.harga_dp),
      hargaPl: numOrNull(r.harga_pl),
      flags: obj(r.flags),
    });
    perAnalyzer.set(id, list);
  }

  return {
    analyzers: aRows.map((a) => ({
      kategori: String(a.kategori),
      kode: String(a.kode),
      label: String(a.label),
      brand: (a.brand as string) ?? null,
      defaultCapex: num(a.default_capex),
      defaultCapexPl: numOrNull(a.default_capex_pl),
      defaultDisc: num(a.default_disc),
      defaultKsoBulan: num(a.default_kso_bulan),
      defaultMarkup: num(a.default_markup),
      defaultTests: num(a.default_tests),
      presets: Array.isArray(a.presets) ? (a.presets as number[]).map(Number) : [],
      meta: obj(a.meta),
      reagents: perAnalyzer.get(Number(a.id)) ?? [],
    })),
    parameters: pRows.map((p) => ({
      grup: p.grup as KsoParameter["grup"],
      no: Number(p.no),
      nama: String(p.nama),
      panel: (p.panel as string) ?? null,
      pack: (p.pack as string) ?? null,
      testsPerKit: numOrNull(p.tests_per_kit),
      hargaDp: numOrNull(p.harga_dp),
      hargaPl: numOrNull(p.harga_pl),
      flags: obj(p.flags),
    })),
    panels: nRows.map((n) => ({ grup: String(n.grup), nama: String(n.nama) })),
  };
}
