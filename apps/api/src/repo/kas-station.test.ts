import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KasStationError, awalMinggu, mengandungNul, hariTanpaCatatan, hitungSaldoAkhir, hitungSelisih, isSenin, normCabang,
  parseNominal, parseTanggal, rollupMinggu, round2, statusSesudah, tambahHari, wibHariIni,
  type BarisHarian, type StatusRekap,
} from "./kas-station.js";

const h = (over: Partial<BarisHarian> = {}): BarisHarian => ({
  tanggal: "2026-10-12", saldo_awal: 1_000_000, total_masuk: 0, total_keluar: 0, saldo_fisik: null, ...over,
});

test("hitungSaldoAkhir: awal + masuk − keluar, tanpa galat float", () => {
  assert.equal(hitungSaldoAkhir(1_000_000, 500_000, 200_000), 1_300_000);
  assert.equal(hitungSaldoAkhir(0, 0, 0), 0);
  assert.equal(hitungSaldoAkhir(0.1, 0.2, 0), 0.3);
  assert.equal(hitungSaldoAkhir(100, 0, 100), 0);
});

test("hitungSelisih: null bila fisik kosong; fisik 0 tetap dihitung", () => {
  assert.equal(hitungSelisih(null, 100), null);
  assert.equal(hitungSelisih(100, 100), 0);
  assert.equal(hitungSelisih(90, 100), -10);
  assert.equal(hitungSelisih(110.5, 100), 10.5);
  assert.equal(hitungSelisih(0, 100), -100);
});

test("parseTanggal: hanya tanggal kalender yang valid", () => {
  assert.equal(parseTanggal("2026-10-12"), "2026-10-12");
  assert.equal(parseTanggal("2028-02-29"), "2028-02-29");
  assert.equal(parseTanggal("2026-02-29"), null);
  assert.equal(parseTanggal("2026-02-31"), null);
  assert.equal(parseTanggal("2026-13-01"), null);
  assert.equal(parseTanggal("12/10/2026"), null);
  assert.equal(parseTanggal("2026-10-12T00:00:00Z"), null);
  assert.equal(parseTanggal(""), null);
  assert.equal(parseTanggal(null), null);
  assert.equal(parseTanggal(20261012), null);
  assert.equal(parseTanggal("0000-01-01"), null); // Postgres date tak punya tahun 0
  assert.equal(parseTanggal("0026-10-12"), null); // salah ketik tahun
  assert.equal(parseTanggal("1999-12-31"), null);
  assert.equal(parseTanggal("2000-01-01"), "2000-01-01");
  assert.equal(parseTanggal("2024-02-29"), "2024-02-29"); // kabisat
});

test("minggu Senin–Minggu: isSenin, awalMinggu, tambahHari (lintas bulan/tahun)", () => {
  assert.equal(isSenin("2026-10-12"), true); // Senin
  assert.equal(isSenin("2026-10-13"), false);
  assert.equal(isSenin("2026-10-18"), false); // Minggu
  assert.equal(awalMinggu("2026-10-12"), "2026-10-12");
  assert.equal(awalMinggu("2026-10-18"), "2026-10-12"); // Minggu → Senin sebelumnya
  assert.equal(awalMinggu("2026-10-14"), "2026-10-12");
  assert.equal(tambahHari("2026-12-28", 6), "2027-01-03");
  assert.equal(tambahHari("2026-03-01", -1), "2026-02-28");
});

test("wibHariIni: pakai zona WIB (UTC+7), bukan UTC", () => {
  // 17 Okt 2026 20:00 UTC = 18 Okt 03:00 WIB
  assert.equal(wibHariIni(Date.parse("2026-10-17T20:00:00Z")), "2026-10-18");
  assert.equal(wibHariIni(Date.parse("2026-10-17T16:59:00Z")), "2026-10-17");
});

test("normCabang: trim + huruf besar; non-string → kosong", () => {
  assert.equal(normCabang("  surabaya "), "SURABAYA");
  assert.equal(normCabang(""), "");
  assert.equal(normCabang(null), "");
  assert.equal(normCabang(5), "");
});

test("parseNominal: positif vs nol, desimal, string numerik, nilai aneh", () => {
  assert.equal(parseNominal(1000, "n", { min: "positif" }), 1000);
  assert.equal(parseNominal("1500.5", "n", { min: "positif" }), 1500.5);
  assert.equal(parseNominal(" 12 ", "n", { min: "positif" }), 12);
  assert.equal(parseNominal(1_000_000_000_000, "n", { min: "positif" }), 1_000_000_000_000); // tepat di batas
  assert.equal(parseNominal(0, "n", { min: "nol" }), 0);
  const gagal = (v: unknown, min: "nol" | "positif") =>
    assert.throws(() => parseNominal(v, "nominal", { min }), (e) => e instanceof KasStationError && e.status === 400);
  gagal(0, "positif");
  gagal(-1, "positif");
  gagal(-1, "nol");
  gagal(1.005, "positif"); // > 2 desimal
  gagal("abc", "positif");
  gagal("", "positif");
  gagal(null, "positif");
  gagal(undefined, "positif");
  gagal(NaN, "positif");
  gagal(Infinity, "positif");
  gagal(1e20, "positif");
  gagal(1_000_000_000_001, "positif"); // di atas batas 1 triliun
  gagal("0x10", "positif");
  gagal("1e3", "positif");
  gagal("1,000", "positif");
  gagal(" ", "nol");
  gagal("12abc", "positif");
  gagal({}, "positif");
  gagal(true, "positif");
});

test("round2", () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-0.004), -0);
  assert.equal(round2(10), 10);
});

test("rollupMinggu: kosong → null", () => {
  assert.equal(rollupMinggu([]), null);
});

test("rollupMinggu: satu hari", () => {
  const r = rollupMinggu([h({ total_masuk: 200_000, total_keluar: 50_000 })]);
  assert.deepEqual(r, {
    jumlah_hari: 1, saldo_awal: 1_000_000, total_masuk: 200_000, total_keluar: 50_000,
    saldo_akhir: 1_150_000, total_selisih: 0, jumlah_hari_selisih: 0,
  });
});

test("rollupMinggu: beberapa hari berantai, urutan input acak, hari bolong tidak masalah", () => {
  const r = rollupMinggu([
    h({ tanggal: "2026-10-15", saldo_awal: 900_000, total_masuk: 0, total_keluar: 100_000 }), // Kamis
    h({ tanggal: "2026-10-12", saldo_awal: 1_000_000, total_masuk: 0, total_keluar: 100_000 }), // Senin
  ]);
  assert.equal(r?.jumlah_hari, 2);
  assert.equal(r?.saldo_awal, 1_000_000); // dari hari pertama
  assert.equal(r?.total_keluar, 200_000);
  assert.equal(r?.saldo_akhir, 800_000); // dari hari terakhir
});

test("rollupMinggu: selisih hanya dari hari yang punya saldo fisik", () => {
  const r = rollupMinggu([
    h({ tanggal: "2026-10-12", saldo_awal: 100, total_keluar: 10, saldo_fisik: 85 }), // akhir 90 → -5
    h({ tanggal: "2026-10-13", saldo_awal: 90, total_masuk: 10, saldo_fisik: 100 }), // akhir 100 → 0
    h({ tanggal: "2026-10-14", saldo_awal: 100, saldo_fisik: null }), // tidak dihitung
    h({ tanggal: "2026-10-15", saldo_awal: 100, saldo_fisik: 103.5 }), // +3.5
  ]);
  assert.equal(r?.total_selisih, -1.5);
  assert.equal(r?.jumlah_hari_selisih, 2);
});

test("hariTanpaCatatan: hari kalender tanpa catatan dalam minggu rekap", () => {
  assert.deepEqual(hariTanpaCatatan("2026-10-12", ["2026-10-12", "2026-10-14", "2026-10-18"]),
    ["2026-10-13", "2026-10-15", "2026-10-16", "2026-10-17"]);
  assert.deepEqual(hariTanpaCatatan("2026-10-12", []).length, 7);
  assert.deepEqual(hariTanpaCatatan("2026-10-12", ["2026-10-20"]).length, 7); // di luar minggu diabaikan
});

test("hariTanpaCatatan: tanggal yang belum tiba tidak dihitung (minggu berjalan)", () => {
  // hari ini Rabu 14 Okt: Senin ada, Selasa & Rabu kosong; Kamis–Minggu belum tiba
  assert.deepEqual(hariTanpaCatatan("2026-10-12", ["2026-10-12"], "2026-10-14"), ["2026-10-13", "2026-10-14"]);
  assert.deepEqual(hariTanpaCatatan("2026-10-12", [], "2026-10-12"), ["2026-10-12"]);
  assert.deepEqual(hariTanpaCatatan("2026-10-12", ["2026-10-12"], "2026-10-12"), []);
});

test("statusSesudah: transisi sah", () => {
  assert.equal(statusSesudah("draft", "submit"), "submitted");
  assert.equal(statusSesudah("rejected", "submit"), "submitted"); // perbaiki & ajukan lagi
  assert.equal(statusSesudah("submitted", "approve"), "approved");
  assert.equal(statusSesudah("submitted", "reject"), "rejected");
  assert.equal(statusSesudah("approved", "realisasi"), "approved");
});

test("statusSesudah: semua transisi tak sah ditolak", () => {
  const semua: StatusRekap[] = ["draft", "submitted", "approved", "rejected"];
  const sah = new Set(["draft:submit", "rejected:submit", "submitted:approve", "submitted:reject", "approved:realisasi"]);
  for (const s of semua) {
    for (const a of ["submit", "approve", "reject", "realisasi"] as const) {
      assert.equal(statusSesudah(s, a) !== null, sah.has(`${s}:${a}`), `${s} + ${a}`);
    }
  }
});

test("mengandungNul: teks, array, objek bersarang, kunci; teks `\\u0000` literal bukan NUL", () => {
  assert.equal(mengandungNul("a\u0000b"), true);
  assert.equal(mengandungNul("aman"), false);
  assert.equal(mengandungNul("\\u0000 diketik literal"), false);
  assert.equal(mengandungNul({ a: { b: ["x", "y\u0000"] } }), true);
  assert.equal(mengandungNul({ ["k\u0000"]: 1 }), true);
  assert.equal(mengandungNul({ a: 1, b: null, c: [1, true, {}] }), false);
  assert.equal(mengandungNul(null), false);
  assert.equal(mengandungNul(undefined), false);
  assert.equal(mengandungNul(42), false);
});
