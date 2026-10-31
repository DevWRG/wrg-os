import { test } from "node:test";
import assert from "node:assert/strict";
import { terapkanBasis } from "./basis";
import type { KsoAnalyzer, KsoMaster, KsoParameter, KsoReagent } from "./types";

// angka FIKTIF (repo publik)
const reagen = (o: Partial<KsoReagent>): KsoReagent => ({ kode: "lyse", jenis: "reagent", nama: "Lyse", pack: null, vol: 1000, yieldTest: null, hargaDp: 500, hargaPl: 800, hargaBeli: null, flags: {}, ...o });
const alat = (o: Partial<KsoAnalyzer>): KsoAnalyzer => ({
  kategori: "HEMATO", kode: "Z1", label: "Z1", brand: null, defaultCapex: 100, defaultCapexPl: 120, defaultDisc: 5,
  defaultKsoBulan: 36, defaultMarkup: 0, defaultTests: 0, hppAlat: null, hppSumber: null, presets: [], meta: {}, reagents: [], ...o,
});
const param = (o: Partial<KsoParameter>): KsoParameter => ({ grup: "CC", no: 1, nama: "GLU", panel: null, pack: null, testsPerKit: 100, hargaDp: 300, hargaPl: 400, hargaBeli: null, flags: {}, ...o });
const M = (a: KsoAnalyzer[], p: KsoParameter[] = []): KsoMaster => ({ analyzers: a, parameters: p, panels: [] });

test("basis daftar = master apa adanya", () => {
  const m = M([alat({ hppAlat: 50, reagents: [reagen({ hargaBeli: 200 })] })]);
  assert.equal(terapkanBasis(m, "daftar"), m);
});

test("basis beli: harga beli menggantikan DP & PL; yang kosong tetap harga lama", () => {
  const m = terapkanBasis(M([alat({ reagents: [reagen({ hargaBeli: 200 }), reagen({ kode: "dil" })] })], [param({ hargaBeli: 150 }), param({ no: 2 })]), "beli");
  const [r1, r2] = m.analyzers[0].reagents;
  assert.deepEqual([r1.hargaDp, r1.hargaPl], [200, 200]);
  assert.deepEqual([r2.hargaDp, r2.hargaPl], [500, 800]);
  assert.deepEqual([m.parameters[0].hargaDp, m.parameters[0].hargaPl], [150, 150]);
  assert.deepEqual([m.parameters[1].hargaDp, m.parameters[1].hargaPl], [300, 400]);
});

test("basis beli: harga alat = HPP, diskon nol; tanpa HPP tetap harga daftar", () => {
  const m = terapkanBasis(M([alat({ hppAlat: 70 }), alat({ kode: "Z2" })]), "beli");
  assert.deepEqual([m.analyzers[0].defaultCapex, m.analyzers[0].defaultCapexPl, m.analyzers[0].defaultDisc], [70, 70, 0]);
  assert.deepEqual([m.analyzers[1].defaultCapex, m.analyzers[1].defaultCapexPl, m.analyzers[1].defaultDisc], [100, 120, 5]);
});

test("harga beli 0 tetap dipakai (barang gratis prinsipal), bukan dianggap kosong", () => {
  const m = terapkanBasis(M([alat({ reagents: [reagen({ hargaBeli: 0 })] })]), "beli");
  assert.equal(m.analyzers[0].reagents[0].hargaDp, 0);
});
