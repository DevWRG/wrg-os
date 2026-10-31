import { test } from "node:test";
import assert from "node:assert/strict";
import {
  angkaReal, biayaTes, cicilanTes, gpm, gridHarga, gridVolume, hargaMin, hppMaks, izinBottomLine, volumeMin, zona,
  type Angka,
} from "./kso-komite-bottomline.js";
import type { PenggunaKso } from "./kso-komite.js";
import type { Effective } from "./rbac.js";

const user = (o: Partial<PenggunaKso> = {}): PenggunaKso => ({ id: "u1", name: "U", role: "user", am_id: null, hod_key: null, ...o });
const eff = (o: Partial<Effective> = {}): Effective => ({ superuser: false, groups: [{ id: 1, key: "g", name: "G" }], permissions: {}, ...o });
const izin = (view: boolean, edit: boolean, active = true) => ({ active, view, create: false, edit, delete: false });
const Z = { am: 0.55, hod: 0.5, forum: 0.45 };

// angka FIKTIF (repo publik — angka biaya/HPP asli tidak boleh di sini)
const A: Angka = { reagen: 2000, tetap: 100_000, qc: 900_000, hpp: 72_000_000 };

test("komponen biaya: reagen + (tetap + QC)/volume; cicilan = HPP/(tenor × volume)", () => {
  assert.equal(biayaTes(A, 1000), 3000);
  assert.equal(cicilanTes(A, 1000, 36), 2000);
  assert.equal(biayaTes({ ...A, reagen: null }, 1000), null);
  assert.equal(cicilanTes({ ...A, hpp: null }, 1000, 36), null);
});

test("GPM deal = 1 − (biaya + cicilan)/harga", () => {
  assert.equal(gpm(A, 10_000, 1000, 36), 0.5);
  assert.equal(gpm({ ...A, hpp: null }, 10_000, 1000, 36), null, "HPP kosong ≠ alat gratis");
  assert.equal(gpm(A, null, 1000, 36), null);
});

test("harga minimum, volume minimum, HPP maksimal konsisten dengan GPM", () => {
  const h = hargaMin(A, 1000, 0.45, 36)!;
  assert.ok(Math.abs(gpm(A, h, 1000, 36)! - 0.45) < 1e-9);
  const v = volumeMin(A, 10_000, 0.45, 36)!;
  assert.ok(Math.abs(gpm(A, 10_000, v, 36)! - 0.45) < 1e-9);
  const hm = hppMaks(A, 10_000, 1000, 0.45, 36)!;
  assert.ok(Math.abs(gpm({ ...A, hpp: hm }, 10_000, 1000, 36)! - 0.45) < 1e-9);
});

test("volume minimum tak tercapai bila reagen saja sudah melebihi margin; HPP maks tak negatif", () => {
  assert.equal(volumeMin(A, 3000, 0.45, 36), null);
  assert.equal(hppMaks(A, 3000, 1000, 0.45, 36), 0);
});

test("zona: ≥55 AM · 50–55 HOD · 45–50 Forum · <45 Direktur", () => {
  assert.equal(zona(0.55, Z), "am");
  assert.equal(zona(0.5499, Z), "hod");
  assert.equal(zona(0.5, Z), "hod");
  assert.equal(zona(0.45, Z), "forum");
  assert.equal(zona(0.4499, Z), "direktur");
  assert.equal(zona(null, Z), null);
});

test("real bottom: promo X/(X+Y), prinsipal HPP 0, QC gratis; promo termurah menang", () => {
  assert.equal(angkaReal(A, [{ jenis_dukungan: "promo", beli_x: 3, gratis_y: 1 }]).hpp, 54_000_000);
  assert.equal(angkaReal(A, [{ jenis_dukungan: "promo", beli_x: 3, gratis_y: 1 }, { jenis_dukungan: "promo", beli_x: 1, gratis_y: 1 }]).hpp, 36_000_000);
  assert.equal(angkaReal(A, [{ jenis_dukungan: "prinsipal", beli_x: null, gratis_y: null }]).hpp, 0);
  assert.equal(angkaReal(A, [{ jenis_dukungan: "qc_gratis", beli_x: null, gratis_y: null }]).qc, 0);
  assert.deepEqual(angkaReal(A, []), A);
});

test("grid peta GPM", () => {
  assert.deepEqual(gridVolume("Hemodialisa", "tindakan"), [12, 24, 36, 48, 60, 72]);
  assert.equal(gridVolume("Hematologi", "tes")[0], 100);
  const g = gridHarga(10_000, 15_000, null);
  assert.equal(g[0], 8000);
  assert.equal(g[g.length - 1], 18_000);
  assert.deepEqual(gridHarga(null, null, null), []);
  assert.ok(gridHarga(null, null, 5000).length > 0, "tanpa harga pasar → sekitar realisasi");
});

test("izin: tiga fitur terpisah; Finance angka saja tetap bisa membuka tab", () => {
  const finance = izinBottomLine(user(), eff({ permissions: { "kso-komite-bottomline-angka": izin(false, true) } }));
  assert.deepEqual(finance, { lihat: true, putus: false, angka: true, realLihat: false, realCatat: false });
  const komite = izinBottomLine(user(), eff({ permissions: { "kso-komite-bottomline": izin(true, false) } }));
  assert.deepEqual(komite, { lihat: true, putus: false, angka: false, realLihat: false, realCatat: false });
  const mati = izinBottomLine(user(), eff({ permissions: { "kso-komite-bottomline": izin(true, true, false) } }));
  assert.equal(mati.lihat, false);
});

test("izin: superuser semua; role admin TIDAK otomatis; direktur lewat gate lama; tanpa grup tidak", () => {
  assert.deepEqual(izinBottomLine(user(), eff({ superuser: true })), { lihat: true, putus: true, angka: true, realLihat: true, realCatat: true });
  assert.equal(izinBottomLine(user({ role: "admin" }), eff()).lihat, false);
  assert.deepEqual(izinBottomLine(user({ role: "direktur" }), eff()), { lihat: true, putus: true, angka: true, realLihat: true, realCatat: true });
  assert.equal(izinBottomLine(user({ role: "direktur" }), eff({ groups: [] })).lihat, false);
  // real bottom tertutup bila fitur real diatur tanpa centang, walau role direktur
  const tutup = izinBottomLine(user({ role: "direktur" }), eff({ permissions: { "kso-komite-bottomline-real": izin(false, false) } }));
  assert.equal(tutup.realLihat, false);
});
