import { test } from "node:test";
import assert from "node:assert/strict";
import { biayaPerTes, gridVolume, izinBottomLine, lantai, posisi } from "./kso-komite-bottomline.js";
import type { PenggunaKso } from "./kso-komite.js";
import type { Effective } from "./rbac.js";

const user = (o: Partial<PenggunaKso> = {}): PenggunaKso => ({ id: "u1", name: "U", role: "user", am_id: null, hod_key: null, ...o });
const eff = (o: Partial<Effective> = {}): Effective => ({ superuser: false, groups: [{ id: 1, key: "g", name: "G" }], permissions: {}, ...o });
const izin = (view: boolean, edit: boolean, active = true) => ({ active, view, create: false, edit, delete: false });

test("rumus lantai: reagen + biaya tetap ÷ volume + K × HPP ÷ bulan ÷ volume (angka fiktif)", () => {
  // reagen 1.000/tes + biaya tetap 200.000/bln, volume 100 tes, HPP 36.000.000, K=3, 36 bln
  assert.equal(biayaPerTes(1000, 200000, 100), 3000);
  assert.equal(lantai(1000, 200000, 100, 36_000_000, 3, 36), 33000);
});

test("lantai tanpa HPP = biaya reagen saja; tanpa volume/biaya = tak terhitung", () => {
  assert.equal(lantai(1000, 0, 100, null, 3, 36), 1000);
  assert.equal(lantai(1000, 50000, 100, 0, 3, 36), 1500);
  assert.equal(lantai(null, 0, 100, 1e6, 3, 36), null);
  assert.equal(lantai(1000, 0, null, 1e6, 3, 36), null);
  assert.equal(lantai(1000, 0, 0, 1e6, 3, 36), null);
});

test("posisi realisasi: aman ≥ lantai+penyangga, tipis ≥ lantai, bawah < lantai", () => {
  assert.equal(posisi(12000, 10000, 20), "aman");
  assert.equal(posisi(11999, 10000, 20), "tipis");
  assert.equal(posisi(10000, 10000, 20), "tipis");
  assert.equal(posisi(9999, 10000, 20), "bawah");
  assert.equal(posisi(null, 10000, 20), "na");
  assert.equal(posisi(10000, null, 20), "na");
});

test("grid sensitivitas mengikuti satuan & kelompok", () => {
  assert.deepEqual(gridVolume("Hemodialisa", "tindakan"), [12, 24, 36, 48, 60, 72]);
  assert.equal(gridVolume("Hematologi", "tes")[0], 100);
  assert.equal(gridVolume("POCT", "tes")[0], 10);
});

test("izin: matriks menentukan; superuser lolos; role admin TIDAK otomatis", () => {
  assert.deepEqual(izinBottomLine(user(), eff({ superuser: true })), { lihat: true, ubah: true });
  assert.deepEqual(izinBottomLine(user({ role: "admin" }), eff()), { lihat: false, ubah: false });
  assert.deepEqual(izinBottomLine(user(), eff({ permissions: { "kso-komite-bottomline": izin(true, false) } })), { lihat: true, ubah: false });
  assert.deepEqual(izinBottomLine(user(), eff({ permissions: { "kso-komite-bottomline": izin(true, true, false) } })), { lihat: false, ubah: false });
});

test("izin gate lama: direktur boleh sebelum fitur diatur; user tanpa grup tidak", () => {
  assert.deepEqual(izinBottomLine(user({ role: "direktur" }), eff()), { lihat: true, ubah: true });
  assert.deepEqual(izinBottomLine(user({ role: "direktur" }), eff({ groups: [] })), { lihat: false, ubah: false });
  assert.deepEqual(izinBottomLine(user({ role: "am", am_id: "x" }), eff()), { lihat: false, ubah: false });
});
