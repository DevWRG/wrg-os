import { test } from "node:test";
import assert from "node:assert/strict";
import { biayaOtomatis, biayaOtomatisBg, biayaOtomatisElektro, biayaOtomatisHemato, biayaOtomatisKk, type MixKk } from "./biaya-otomatis";
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

// ── 284: Kimia Klinik & Blood Gas (angka FIKTIF) ──
const exc = (o: Partial<KsoAnalyzer> = {}): KsoAnalyzer => z3({
  kategori: "CC", kode: "EXC200", label: "EXC200", modelKey: "m-exc",
  reagents: [reagen({ kode: "conc", nama: "Conc Detergent", jenis: "consumable", vol: 20000, hargaBeli: 2000 }),
             reagen({ kode: "probe_d", nama: "Probe Detergent", jenis: "consumable", vol: 240, hargaBeli: 240 })], ...o,
});
const mix = (o: Partial<MixKk>): MixKk => ({ analyzer: "EXC200", parameter: "GLU", sku: "S1", tesPerKemasan: 100, kit12bln: 1, hpp: 1000, ...o });

test("KK: reagen per tes = Σ(kit × HPP) ÷ Σ(kit × tes) dari kiriman riil + detergent; harian = detergent tetap", () => {
  // GLU: 3 kit × 100 tes @1.000 · SGOT: 1 kit × 200 tes @4.000 → (3.000 + 4.000) ÷ 500 = 14 per tes
  const m = [mix({}), mix({ kit12bln: 3 }), mix({ parameter: "SGOT", sku: "S2", tesPerKemasan: 200, kit12bln: 1, hpp: 4000 }), mix({ parameter: "TG", sku: "S3", kit12bln: 0, hpp: null })];
  const { baris, kurang } = biayaOtomatisKk([exc()], m.slice(1), 25);
  assert.deepEqual(kurang, []);
  // detergent per mL: conc 0,1 · probe 1 → per tes 0,28 × 0,1 = 0,028; harian (1,68 + 25,88×5)×0,1 + (2,4 + 3,15×5)×1 = 31,276
  assert.equal(baris[0].biaya_per_tes, 14.03);
  assert.equal(baris[0].biaya_tetap_harian, 31);
  assert.match(baris[0].rincian ?? "", /campuran tes riil: 2 SKU, 500 tes/);
});

test("KK: tanpa kiriman / SKU terkirim tanpa HPP / detergent tanpa HPP → dilewati dengan alasan", () => {
  assert.deepEqual(biayaOtomatisKk([exc()], [], 25).kurang, [{ alat: "EXC200", reagen: ["belum ada kiriman reagen 12 bulan (campuran tes)"] }]);
  assert.deepEqual(biayaOtomatisKk([exc()], [mix({ hpp: null })], 25).kurang, [{ alat: "EXC200", reagen: ["GLU (S1)"] }]);
  const tanpaDet = exc({ reagents: [reagen({ kode: "conc", nama: "Conc Detergent", vol: 20000, hargaBeli: null }), reagen({ kode: "probe_d", nama: "Probe Detergent", vol: 240 })] });
  assert.deepEqual(biayaOtomatisKk([tanpaDet], [mix({})], 25).kurang, [{ alat: "EXC200", reagen: ["Conc Detergent"] }]);
});

const pt = (o: Partial<KsoAnalyzer> = {}): KsoAnalyzer => z3({
  kategori: "BG", kode: "PT1000", label: "PT1000", modelKey: "m-bg", meta: { stability: 20 },
  reagents: [reagen({ kode: "c60", nama: "Cartridge 60T", jenis: "cartridge", vol: null, yieldTest: 60, hargaBeli: 600 }),
             reagen({ kode: "c200", nama: "Cartridge 200T", jenis: "cartridge", vol: null, yieldTest: 200, hargaBeli: 1600 }),
             reagen({ kode: "c120", nama: "Cartridge 120T", jenis: "cartridge", vol: null, yieldTest: 120, hargaBeli: null })], ...o,
});

test("BG: tiap cartridge ber-HPP = pilihan {harga ÷ kapasitas, harga × 30 ÷ masa pakai}; tanpa HPP tak ikut", () => {
  const { baris, kurang } = biayaOtomatisBg([pt()]);
  assert.deepEqual(kurang, []);
  assert.deepEqual(baris[0].biaya_tangga, [{ per_tes: 10, min_bulan: 900 }, { per_tes: 8, min_bulan: 2400 }]);
  assert.equal(baris[0].biaya_per_tes, 8);
  assert.equal(baris[0].biaya_tetap_harian, 0);
});

test("BG: tanpa masa pakai / tanpa cartridge ber-HPP → dilewati", () => {
  assert.equal(biayaOtomatisBg([pt({ meta: {} })]).kurang[0].reagen[0], "masa pakai cartridge belum diisi");
  const kosong = pt({ reagents: pt().reagents.map((r) => ({ ...r, hargaBeli: null })) });
  assert.equal(biayaOtomatisBg([kosong]).baris.length, 0);
});

test("biayaOtomatis menggabungkan hematologi, KK, BG", () => {
  const h = biayaOtomatis({ analyzers: [z3(), exc(), pt()], hariKerja: 25, mixKk: [mix({})] });
  assert.deepEqual(h.baris.map((b) => b.model_key), ["m-z3", "m-exc", "m-bg"]);
});

test("KK alat baru (tanpa kiriman sendiri) → campuran tes alat sejenis dijumlah per SKU (286)", () => {
  const e4 = exc({ kode: "EXC400", label: "EXC400", modelKey: "m-e4" });
  const m = [mix({ kit12bln: 3 }), mix({ analyzer: "EXC220", kit12bln: 1 }), mix({ analyzer: "EXC400", kit12bln: 0 })];
  const { baris, kurang } = biayaOtomatisKk([e4], m, 25);
  assert.deepEqual(kurang, []);
  assert.match(baris[0].rincian ?? "", /alat sejenis \(EXC200, EXC220\): 1 SKU, 400 tes/);
  assert.equal(baris[0].biaya_per_tes, 10.02); // 1.000 ÷ 100 tes + detergent EXC400 0,2 × 0,1
});

test("Elektrolit DN-X6: paket cartridge → reagen/tes = 0,8 mL × harga/mL, harian = 21 mL × harga/mL (288)", () => {
  const dn = z3({ kategori: "ELEKTRO", kode: "DNX6", label: "DN-X6", modelKey: "m-dn",
    reagents: [reagen({ kode: "cart_reagen", nama: "Cartridge Reagen", vol: 650, hargaBeli: 65000 })] });
  const { baris, kurang } = biayaOtomatisElektro([dn], 25);
  assert.deepEqual(kurang, []);
  assert.equal(baris[0].biaya_per_tes, 80);          // 0,8 × 100
  assert.equal(baris[0].biaya_tetap_harian, 2100);   // 21 × 100
  const tanpa = z3({ kategori: "ELEKTRO", kode: "DNX6", label: "DN-X6", modelKey: "m-dn", reagents: [] });
  assert.equal(biayaOtomatisElektro([tanpa], 25).kurang[0].alat, "DN-X6");
});
