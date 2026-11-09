import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KasStationError, awalMinggu, bolehCabang, cekCabangTulis, pemutusSamaPengaju, putuskanCakupan, mengandungNul, hariTanpaCatatan, hitungSaldoAkhir, hitungSelisih, isSenin, normCabang,
  parseNominal, parseTanggal, rollupMinggu, round2, statusSesudah, tambahHari, wibHariIni,
  type BarisHarian, type IdentitasKas, type StatusRekap, rantaiSaldo } from "./kas-station.js";

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

test("pemutusSamaPengaju: banding trim + tanpa beda huruf; fallback created_by", () => {
  assert.equal(pemutusSamaPengaju("a@x.id", { submitted_by: " A@X.ID ", created_by: null }), true);
  assert.equal(pemutusSamaPengaju("b@x.id", { submitted_by: "a@x.id", created_by: "b@x.id" }), false);
  assert.equal(pemutusSamaPengaju("b@x.id", { submitted_by: null, created_by: "B@x.id" }), true);
  assert.equal(pemutusSamaPengaju("b@x.id", { submitted_by: null, created_by: null }), false);
  assert.equal(pemutusSamaPengaju(null, { submitted_by: null, created_by: null }), false);
  assert.equal(pemutusSamaPengaju("  ", { submitted_by: "  ", created_by: null }), false);
});

const ident = (over: Partial<IdentitasKas> = {}): IdentitasKas => ({
  role: "user", superuser: false, reviewView: false, cabang: " Madiun ", ...over,
});

test("putuskanCakupan: tanpa header = semua; user tak dikenal = tanpa cabang", () => {
  assert.deepEqual(putuskanCakupan(false, null), { semua: true });
  assert.deepEqual(putuskanCakupan(true, null), { semua: false, cabang: null });
});

test("putuskanCakupan: pusat (review/superuser/admin/direktur) = semua; station = cabangnya", () => {
  assert.deepEqual(putuskanCakupan(true, ident({ reviewView: true })), { semua: true });
  assert.deepEqual(putuskanCakupan(true, ident({ superuser: true })), { semua: true });
  assert.deepEqual(putuskanCakupan(true, ident({ role: " Admin " })), { semua: true });
  assert.deepEqual(putuskanCakupan(true, ident({ role: "direktur", cabang: null })), { semua: true });
  assert.deepEqual(putuskanCakupan(true, ident()), { semua: false, cabang: "MADIUN" });
  assert.deepEqual(putuskanCakupan(true, ident({ cabang: "  " })), { semua: false, cabang: null });
  assert.deepEqual(putuskanCakupan(true, ident({ role: null, cabang: null })), { semua: false, cabang: null });
});

test("bolehCabang: semua lolos; station hanya cabangnya; record tak ada ditolak", () => {
  assert.equal(bolehCabang({ semua: true }, "SBY 2"), true);
  assert.equal(bolehCabang({ semua: false, cabang: "MADIUN" }, "MADIUN"), true);
  assert.equal(bolehCabang({ semua: false, cabang: "MADIUN" }, "SBY 2"), false);
  assert.equal(bolehCabang({ semua: false, cabang: "MADIUN" }, null), false);
  assert.equal(bolehCabang({ semua: false, cabang: null }, "MADIUN"), false);
});

test("cekCabangTulis: 403 untuk cabang lain / akun tanpa cabang", () => {
  assert.doesNotThrow(() => cekCabangTulis({ semua: true }, "SBY 2"));
  assert.doesNotThrow(() => cekCabangTulis({ semua: false, cabang: "SBY 2" }, " sby 2 "));
  assert.doesNotThrow(() => cekCabangTulis({ semua: false, cabang: "SBY 2" }, "")); // kosong → 400 di repo
  const status403 = (fn: () => void, pesan: RegExp) =>
    assert.throws(fn, (e: unknown) => e instanceof KasStationError && e.status === 403 && pesan.test(e.message));
  status403(() => cekCabangTulis({ semua: false, cabang: "SBY 2" }, "MADIUN"), /cabang Anda \(SBY 2\)/);
  status403(() => cekCabangTulis({ semua: false, cabang: null }, "MADIUN"), /belum punya cabang/);
});

test("rantaiSaldo: saldo awal tiap catatan = saldo akhir sebelumnya; sisipan mundur menggeser hari sesudahnya", () => {
  const rows = [
    { id: "a", tanggal: "2026-11-02", saldo_awal: 1_000_000, masuk: 0, keluar: 100_000 },
    // rapel: 3 Nov disisipkan belakangan (keluar 50 rb) — 4 Nov masih menyimpan saldo awal lama 900 rb
    { id: "b", tanggal: "2026-11-03", saldo_awal: 900_000, masuk: 0, keluar: 50_000 },
    { id: "c", tanggal: "2026-11-04", saldo_awal: 900_000, masuk: 20_000, keluar: 0 },
  ];
  assert.deepEqual(rantaiSaldo(rows), { berubah: [{ id: "c", saldo_awal: 850_000 }], negatif: null });
  // sudah konsisten → tak ada perubahan
  assert.deepEqual(rantaiSaldo([rows[0], rows[1], { ...rows[2], saldo_awal: 850_000 }]), { berubah: [], negatif: null });
  // sisipan yang membuat hari sesudahnya negatif → tanggal itu dilaporkan
  const minus = rantaiSaldo([rows[0], { ...rows[1], keluar: 880_000 }, { ...rows[2], keluar: 100_000 }]);
  assert.equal(minus.negatif, "2026-11-04");
  assert.deepEqual(rantaiSaldo([]), { berubah: [], negatif: null });
  // pembulatan sen tidak dianggap berubah
  assert.deepEqual(rantaiSaldo([{ id: "x", tanggal: "2026-11-01", saldo_awal: 100.1, masuk: 0.2, keluar: 0 }, { id: "y", tanggal: "2026-11-02", saldo_awal: 100.3, masuk: 0, keluar: 0 }]).berubah, []);
});
