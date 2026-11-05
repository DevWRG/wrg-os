import { test } from "node:test";
import assert from "node:assert/strict";
import { alasanTolakBerkas, ArsipError, formatNomor, KODE_BUKU, metaDari, periodeDari, periodeFilter } from "./arsip-dokumen.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

test("formatNomor ikut SOP BUKU/TAHUN/BULAN/URUT, bulan 2 digit, urut 4 digit", () => {
  assert.equal(formatNomor("BKK", 2026, 11, 1), "BKK/2026/11/0001");
  assert.equal(formatNomor("SJ", 2026, 3, 125), "SJ/2026/03/0125");
  assert.equal(formatNomor("BA", 2026, 12, 12345), "BA/2026/12/12345");
});

test("periodeDari: tanggal kalender nyata, tidak di masa depan, tahun ≥ 2000", () => {
  assert.deepEqual(periodeDari("2026-11-05", "2026-11-05"), { tanggal: "2026-11-05", tahun: 2026, bulan: 11 });
  assert.deepEqual(periodeDari("2026-01-31", "2026-11-05"), { tanggal: "2026-01-31", tahun: 2026, bulan: 1 });
  assert.equal(periodeDari("2026-11-06", "2026-11-05"), null); // masa depan
  assert.equal(periodeDari("2026-02-30", "2026-11-05"), null); // tak ada di kalender
  assert.equal(periodeDari("1999-12-31", "2026-11-05"), null);
  assert.equal(periodeDari("5/11/2026", "2026-11-05"), null);
  assert.equal(periodeDari(undefined, "2026-11-05"), null);
});

test("periodeFilter hanya terima YYYY-MM", () => {
  assert.deepEqual(periodeFilter("2026-11"), { tahun: 2026, bulan: 11 });
  assert.equal(periodeFilter("2026-13"), null);
  assert.equal(periodeFilter("2026-1"), null);
  assert.equal(periodeFilter(null), null);
});

test("KODE_BUKU: huruf besar/angka, diawali huruf, 2-10 karakter", () => {
  for (const k of ["BKK", "SJ", "PJK", "B2B", "ABCDEFGHIJ"]) assert.ok(KODE_BUKU.test(k), k);
  for (const k of ["", "B", "bkk", "1BK", "BK-K", "BK/K", "ABCDEFGHIJK"]) assert.ok(!KODE_BUKU.test(k), k);
});

test("metaDari: judul wajib, spasi dirapikan, kosong jadi null", () => {
  assert.throws(() => metaDari({ judul: "   " }), (e) => e instanceof ArsipError && e.field === "judul");
  const m = metaDari({ judul: "  Bukti   bayar listrik ", ref_faktur: " PJK/2190-2610-LMG ", ref_sn: "", akun: 12 });
  assert.equal(m.judul, "Bukti bayar listrik");
  assert.equal(m.ref_faktur, "PJK/2190-2610-LMG");
  assert.equal(m.ref_sn, null);
  assert.equal(m.akun, null); // bukan string → diabaikan
});

test("alasanTolakBerkas: kosong, > 8 MB, tipe dari isi", () => {
  assert.equal(alasanTolakBerkas(0, new Uint8Array()), "berkas kosong");
  assert.equal(alasanTolakBerkas(8 * 1024 * 1024 + 1, PDF), "berkas maksimal 8 MB");
  assert.equal(alasanTolakBerkas(6, new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0])), "hanya PDF, JPG, atau PNG"); // exe berlabel .pdf
  assert.equal(alasanTolakBerkas(6, PDF), null);
});
