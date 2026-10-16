import { test } from "node:test";
import assert from "node:assert/strict";

import { CnError, bolehPindah, cekBuktiUrl, cekDaftarFaktur, cekFakturKontrak, cekKontrak, cekPindah, hitungNilaiCn, tujuanBerikut } from "./cn.js";

// F151 — logika murni CN (Kredit Note).

const langsung = { hod_business_key: null };
const lewatBiz = { hod_business_key: "mufid" };
const salah = (fn: () => unknown, status?: number, field?: string) =>
  assert.throws(fn, (e) => e instanceof CnError && (status === undefined || e.status === status) && (field === undefined || e.field === field));

test("persen: round(DPP × tarif/100) per faktur", () => {
  assert.deepEqual(hitungNilaiCn("persen", 2, [1_000_000, 500_000]), [20_000, 10_000]);
  assert.deepEqual(hitungNilaiCn("persen", 2.5, [1_000_001]), [25_000]); // 25000.025 → 25000
  assert.deepEqual(hitungNilaiCn("persen", 100, [123]), [123]);
});

test("nominal: dibagi sebanding DPP dan jumlahnya PERSIS sama dengan tarif (largest remainder)", () => {
  const n = hitungNilaiCn("nominal", 100, [1, 1, 1]);
  assert.equal(n.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual([...n].sort(), [33, 33, 34]);
  assert.deepEqual(hitungNilaiCn("nominal", 1_000_000, [3_000_000, 1_000_000]), [750_000, 250_000]);
  assert.deepEqual(hitungNilaiCn("nominal", 500, [900]), [500]);
  assert.deepEqual(hitungNilaiCn("nominal", 500, [0, 0]), [0, 0]);
});

test("rute: tanpa HoD Business → HoD Sales langsung; lewat HoD Business → ditinjau dulu", () => {
  assert.deepEqual(tujuanBerikut("diajukan", langsung), ["disetujui", "ditolak", "dibatalkan"]);
  assert.deepEqual(tujuanBerikut("diajukan", lewatBiz), ["ditinjau", "ditolak", "dibatalkan"]);
  assert.equal(bolehPindah("diajukan", "disetujui", lewatBiz), false); // tak boleh melompati peninjauan
  assert.equal(bolehPindah("ditinjau", "disetujui", lewatBiz), true);
});

test("alur setelah disetujui: Finance lalu GA; tak ada jalan mundur; status akhir final", () => {
  assert.deepEqual(tujuanBerikut("disetujui", langsung), ["divalidasi", "ditolak"]);
  assert.deepEqual(tujuanBerikut("divalidasi", langsung), ["terealisasi", "ditolak"]);
  assert.equal(bolehPindah("divalidasi", "disetujui", langsung), false);
  for (const f of ["terealisasi", "ditolak", "dibatalkan"] as const) assert.deepEqual(tujuanBerikut(f, langsung), []);
  assert.equal(bolehPindah("disetujui", "dibatalkan", langsung), false); // sudah disetujui: hanya bisa ditolak Finance, bukan dibatalkan
});

test("tolak/batal wajib beralasan", () => {
  salah(() => cekPindah("diajukan", "ditolak", langsung, {}, "2026-10-16"), 400, "catatan");
  salah(() => cekPindah("diajukan", "dibatalkan", langsung, { catatan: "  " }, "2026-10-16"), 400, "catatan");
  assert.equal(cekPindah("diajukan", "ditolak", langsung, { catatan: "tarif salah" }, "2026-10-16").catatan, "tarif salah");
});

test("realisasi wajib bukti https; tanggal default hari ini, tak boleh masa depan", () => {
  salah(() => cekPindah("divalidasi", "terealisasi", langsung, {}, "2026-10-16"), 400, "bukti_url");
  salah(() => cekPindah("divalidasi", "terealisasi", langsung, { bukti_url: "http://x.id/a.pdf" }, "2026-10-16"), 400, "bukti_url");
  salah(() => cekPindah("divalidasi", "terealisasi", langsung, { bukti_url: "https://x.id/a.pdf", tanggal_realisasi: "2026-10-17" }, "2026-10-16"), 400, "tanggal_realisasi");
  salah(() => cekPindah("divalidasi", "terealisasi", langsung, { bukti_url: "https://x.id/a.pdf", tanggal_realisasi: "2026-02-30" }, "2026-10-16"), 400, "tanggal_realisasi");
  const ok = cekPindah("divalidasi", "terealisasi", langsung, { bukti_url: "https://x.id/a.pdf" }, "2026-10-16");
  assert.equal(ok.tanggal_realisasi, "2026-10-16");
  assert.equal(cekBuktiUrl("https://drive.google.com/x"), "https://drive.google.com/x");
});

test("perpindahan tak sah → 409; status tak dikenal → 400", () => {
  salah(() => cekPindah("diajukan", "terealisasi", langsung, {}, "2026-10-16"), 409);
  salah(() => cekPindah("diajukan", "ngawur", langsung, {}, "2026-10-16"), 400, "ke");
});

const kontrak = { customer_id: 7, periode_mulai: "2026-01-01", periode_selesai: "2026-06-30" };
const faktur = { invoice_id: 1, invoice_number: "INV-1", tanggal: "2026-03-15", customer_id: 7, dpp: 1000, salesman_name: "A", sudah_dicakup: false };

test("validasi CN per transaksi: customer, periode, DPP, dobel", () => {
  assert.equal(cekFakturKontrak(faktur, kontrak, 1).invoice_id, 1);
  salah(() => cekFakturKontrak(undefined, kontrak, 9), 404);
  salah(() => cekFakturKontrak({ ...faktur, customer_id: 8 }, kontrak, 1), 422);
  salah(() => cekFakturKontrak({ ...faktur, tanggal: "2026-07-01" }, kontrak, 1), 422);
  salah(() => cekFakturKontrak({ ...faktur, tanggal: "2025-12-31" }, kontrak, 1), 422);
  salah(() => cekFakturKontrak({ ...faktur, dpp: 0 }, kontrak, 1), 422);
  salah(() => cekFakturKontrak({ ...faktur, sudah_dicakup: true }, kontrak, 1), 409);
  assert.equal(cekFakturKontrak({ ...faktur, tanggal: "2026-06-30" }, kontrak, 1).tanggal, "2026-06-30"); // batas inklusif
});

test("daftar faktur: wajib, tak dobel, id sah", () => {
  assert.deepEqual(cekDaftarFaktur([1, "2"]), [1, 2]);
  salah(() => cekDaftarFaktur([]), 400);
  salah(() => cekDaftarFaktur("1"), 400);
  salah(() => cekDaftarFaktur([1, 1]), 400);
  salah(() => cekDaftarFaktur([1, -2]), 400);
  salah(() => cekDaftarFaktur(Array.from({ length: 101 }, (_, i) => i + 1)), 400);
});

test("form kontrak: validasi tarif, periode, tautan", () => {
  const ok = { customer_id: 7, jenis: "persen", tarif: "2,5", periode_mulai: "2026-01-01", periode_selesai: "2026-12-31", syarat: " bayar ≤ 30 hari ", file_url: "https://drive.google.com/k" };
  const k = cekKontrak(ok);
  assert.equal(k.tarif, 2.5);
  assert.equal(k.syarat, "bayar ≤ 30 hari");
  salah(() => cekKontrak({ ...ok, tarif: 101 }), 400, "tarif");
  assert.equal(cekKontrak({ ...ok, jenis: "nominal", tarif: 5_000_000 }).tarif, 5_000_000); // batas 100 hanya untuk persen
  salah(() => cekKontrak({ ...ok, tarif: 0 }), 400, "tarif");
  salah(() => cekKontrak({ ...ok, customer_id: "x" }), 400, "customer_id");
  salah(() => cekKontrak({ ...ok, periode_selesai: "2025-12-31" }), 400, "periode_selesai");
  salah(() => cekKontrak({ ...ok, file_url: "ftp://x" }), 400, "file_url");
});
