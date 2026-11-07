import { test } from "node:test";
import assert from "node:assert/strict";
import { nilaiUnitPortofolio, type BarisPortofolio } from "./kso-komite-bottomline.js";
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

// ---------------------------------------------------------------- Tinjauan Portofolio (F170 Fase D)

const P = { tenor: 36, hariKerja: 25, zona: { am: 0.55, hod: 0.5, forum: 0.45 } };
const AP = { reagen: 6000, tetap: 1_500_000, qc: 500_000, hpp: 63_250_000 }; // fiktif — biaya Rp 9.415/tes di 1.100 tes
const HARI_INI = new Date(Date.UTC(2026, 10, 5)); // 5 Nov 2026
const unitDasar: BarisPortofolio = { account_id: 1, mulai: "2025-06-01", omzet: [19_470_000, 19_470_000, 19_470_000], omzet_terakhir: "2026-10-01", piutang_hari: 10 };

test("portofolio: GPM per bulan = gpm() Bottom Line di Rp/tes realisasi; 46,8% → pantau (45–50%)", () => {
  const h = nilaiUnitPortofolio(unitDasar, AP, 17_700, false, P, HARI_INI);
  assert.ok(Math.abs((h.gpm[0] ?? 0) - 0.468) < 0.001);
  assert.deepEqual(h.kondisi, ["gpm_pantau"]);
});

test("portofolio: GPM < 45% tiga bulan berturut-turut; satu bulan tanpa omzet = belum tiga bulan", () => {
  const rendah = { ...unitDasar, omzet: [11_000_000, 11_000_000, 11_000_000] };
  assert.ok(nilaiUnitPortofolio(rendah, AP, 10_000, false, P, HARI_INI).kondisi.includes("gpm_rendah"));
  const bolong = { ...rendah, omzet: [11_000_000, 0, 11_000_000] };
  assert.ok(!nilaiUnitPortofolio(bolong, AP, 10_000, false, P, HARI_INI).kondisi.includes("gpm_rendah"));
});

test("portofolio: idle > 60 hari dari akhir bulan omzet terakhir; alat yang baru ditempatkan tidak", () => {
  const idle = nilaiUnitPortofolio({ ...unitDasar, omzet: [0, 0, 0], omzet_terakhir: "2026-08-01" }, AP, 17_700, false, P, HARI_INI);
  assert.ok(idle.kondisi.includes("idle"));
  assert.equal(idle.idle_hari, 66); // 31 Agu → 5 Nov
  const baru = nilaiUnitPortofolio({ ...unitDasar, mulai: "2026-10-10", omzet: [0, 0, 0], omzet_terakhir: null }, AP, 17_700, false, P, HARI_INI);
  assert.ok(!baru.kondisi.includes("idle"));
  const jalan = nilaiUnitPortofolio(unitDasar, AP, 17_700, false, P, HARI_INI);
  assert.ok(!jalan.kondisi.includes("idle"));
});

test("portofolio: piutang > 90 hari, alat di gudang, biaya kosong & Hemodialisa tanpa GPM", () => {
  assert.ok(nilaiUnitPortofolio({ ...unitDasar, piutang_hari: 91 }, AP, 17_700, false, P, HARI_INI).kondisi.includes("piutang"));
  assert.deepEqual(nilaiUnitPortofolio({ ...unitDasar, account_id: null }, AP, 17_700, false, P, HARI_INI).kondisi, ["gudang"]);
  const kosong = nilaiUnitPortofolio(unitDasar, { ...AP, reagen: null }, 17_700, false, P, HARI_INI);
  assert.deepEqual(kosong.gpm, [null, null, null]);
  assert.deepEqual(kosong.kondisi, []);
  assert.deepEqual(nilaiUnitPortofolio(unitDasar, AP, 17_700, true, P, HARI_INI).gpm, [null, null, null]);
});

test("portofolio: cicilan HPP berhenti sesudah masa tenor sejak alat ditempatkan", () => {
  const lama = nilaiUnitPortofolio({ ...unitDasar, mulai: "2022-01-01" }, AP, 17_700, false, P, HARI_INI);
  assert.equal(lama.cicilan_dihitung, false);
  assert.ok((lama.gpm[0] ?? 0) > 0.55); // tanpa cicilan Rp 1.597/tes → 55,8%
  assert.equal(nilaiUnitPortofolio(unitDasar, AP, 17_700, false, P, HARI_INI).cicilan_dihitung, true);
});

// 284: pilihan kemasan (cartridge BG, residu terbuang) — angka FIKTIF
test("tangga kemasan: reagen = termurah dari max(per tes, minimum ÷ volume); volume minimum per kemasan terbaik", async () => {
  const { reagenTes } = await import("./kso-komite-bottomline.js");
  const T: Angka = { reagen: 60, tetap: 200_000, qc: 300_000, hpp: 36_000_000, tangga: [{ perTes: 60, minBulan: 150_000 }, { perTes: 100, minBulan: 90_000 }] };
  assert.equal(reagenTes(T, 900), 100);            // kecil: max(100, 100) < besar: max(60, 166,7)
  assert.equal(reagenTes(T, 3000), 60);            // besar: max(60, 50)
  assert.ok(Math.abs(biayaTes(T, 900)! - (100 + 500_000 / 900)) < 1e-9);
  // S = 18.500 × 0,55 = 10.175; F = 500 rb + 1 jt = 1,5 jt → besar 162,16 · kecil 156,27
  assert.ok(Math.abs(volumeMin(T, 18_500, 0.45, 36)! - 1_590_000 / 10_175) < 1e-9);
  // tanpa tangga = rumus lama
  assert.equal(reagenTes({ ...T, tangga: null }, 900), 60);
  assert.equal(volumeMin({ ...T, tangga: null }, 18_500, 0.45, 36), 1_500_000 / (10_175 - 60));
  // volume minimum konsisten dengan GPM: tepat di batas → GPM = 45%
  const v = volumeMin(T, 18_500, 0.45, 36)!;
  assert.ok(Math.abs(gpm(T, 18_500, v, 36)! - 0.45) < 1e-9);
});
