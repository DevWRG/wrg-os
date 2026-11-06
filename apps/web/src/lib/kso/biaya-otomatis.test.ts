import { test } from "node:test";
import assert from "node:assert/strict";
import { biayaOtomatisHemato } from "./biaya-otomatis";
import type { KsoAnalyzer, KsoReagent } from "./types";

// angka FIKTIF (repo publik)
const reagen = (o: Partial<KsoReagent>): KsoReagent => ({ kode: "lyse", jenis: "reagent", nama: "Lyse", pack: null, vol: 1000, yieldTest: null, hargaDp: 999, hargaPl: 999, hargaBeli: 100, flags: {}, ...o });
const z3 = (o: Partial<KsoAnalyzer> = {}): KsoAnalyzer => ({
  kategori: "HEMATO", kode: "Z3", label: "Z3", brand: null, defaultCapex: 0, defaultCapexPl: null, defaultDisc: 0,
  defaultKsoBulan: 36, defaultMarkup: 0, defaultTests: 0, hppAlat: null, hppSumber: null, modelKey: "m-z3", presets: [], meta: {},
  reagents: [reagen({ kode: "lyse" }), reagen({ kode: "dil", nama: "Diluent", vol: 20000, hargaBeli: 400 }), reagen({ kode: "probe", nama: "Probe", vol: 50, hargaBeli: 10 })], ...o,
});

test("Z3: reagen per tes & harian dari harga beli; harian tak bergantung volume", () => {
  const { baris, kurang } = biayaOtomatisHemato([z3()], 25);
  assert.deepEqual(kurang, []);
  assert.equal(baris.length, 1);
  // lyse 0,344 mL × 0,1 + dil 21,09 mL × 0,02 = 0,4562
  assert.equal(baris[0].biaya_per_tes, 0.46);
  // lyse 0,894 × 0,1 + dil 137,56 × 0,02 + probe 1 × 0,2 = 3,0406 per hari
  assert.equal(baris[0].biaya_tetap_harian, 3);
});

test("reagen tanpa HPP Price Book → alat dilewati (tak pakai harga daftar)", () => {
  const a = z3({ reagents: [reagen({ kode: "lyse", hargaBeli: null }), reagen({ kode: "dil", nama: "Diluent" }), reagen({ kode: "probe", nama: "Probe", vol: 50 })] });
  const { baris, kurang } = biayaOtomatisHemato([a], 25);
  assert.equal(baris.length, 0);
  assert.deepEqual(kurang, [{ alat: "Z3", reagen: ["Lyse"] }]);
});

test("tanpa model Bottom Line / bukan hemato → diabaikan", () => {
  assert.deepEqual(biayaOtomatisHemato([z3({ modelKey: null }), z3({ kategori: "CC" })], 25), { baris: [], kurang: [] });
});

test("dua alat satu model → yang lebih mahal", () => {
  const murah = z3({ kode: "Z3" });
  const mahal = z3({ kode: "Z3", reagents: murah.reagents.map((r) => ({ ...r, hargaBeli: (r.hargaBeli ?? 0) * 2 })) });
  const { baris } = biayaOtomatisHemato([murah, mahal], 25);
  assert.equal(baris.length, 1);
  assert.equal(baris[0].biaya_per_tes, 0.91);
});
