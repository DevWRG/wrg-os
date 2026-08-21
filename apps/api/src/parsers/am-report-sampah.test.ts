// Regresi baris sampah di #REPORT AM. Semua kasus diambil dari pesan NYATA yang
// sudah tersimpan di activity_log produksi. Murni (tanpa DB):
//   node --test apps/api/dist/parsers/am-report-sampah.test.js
//
// Latar: am.ts tidak membuang mark tak terlihat (dailyplan.ts sudah sejak lama).
// WhatsApp menyisipkan U+200E di awal baris, anchor `^\s*#` gagal karena `\s`
// tak match karakter itu, dan baris header ikut tersimpan sebagai customer.
// Terhitung di produksi: 27 baris header, 35 baris kosong, 57 baris next:/hasil:,
// 32 nama <3 karakter, 184 baris memuat mark tak terlihat.

import test from "node:test";
import assert from "node:assert/strict";

import { parseAmReport } from "./am.js";

const LRM = "‎"; // yang benar-benar disisipkan WhatsApp
const NOW = Date.parse("2026-08-20T05:00:00Z");
const nama = (b: string) => parseAmReport(b, NOW).items.map((i) => i.customer);

test("baris header ber-U+200E tidak jadi customer (kasus Irul)", () => {
  const body = `${LRM}#Report Irul 18/8/2026\nrsu muh babat\nhasil: ketemu analis\nRs nu babat\nhasil: fwup`;
  const n = nama(body);
  assert.deepEqual(n, ["rsu muh babat", "Rs nu babat"]);
  assert.ok(!n.some((x) => /#report/i.test(x)), "header tidak boleh masuk");
});

test("baris yang hanya berisi mark tak terlihat tidak jadi customer", () => {
  const n = nama(`#Report Irul 19/8/2026\nPuskesmas Gunungsari\nhasil: ok\n${LRM}\n${LRM}   \nRSAB Bojonegoro\nhasil: ok`);
  assert.deepEqual(n, ["Puskesmas Gunungsari", "RSAB Bojonegoro"]);
});

test("baris next:/hasil: tanpa customer berjalan dibuang, bukan jadi faskes", () => {
  // Kasus Irul: ".      next: kawal pengadaan" tersimpan sebagai customer.
  const n = nama(`#Report Irul 19/8/2026\n${LRM}.      next: kawal pengadaan\nRs Ibnu Sina Bojonegoro\nhasil: ketemu dr\n`);
  assert.deepEqual(n, ["Rs Ibnu Sina Bojonegoro"]);
});

test("nama < 3 karakter dan sisa tanda baca dibuang", () => {
  const n = nama("#Report X 19/8/2026\n.\n-\nab\nRSUD Tripad\nhasil: ok");
  assert.deepEqual(n, ["RSUD Tripad"]);
});

test("laporan normal tidak berubah — nama sah tetap utuh", () => {
  const n = nama(
    "#Report Sidqi 18/8/2026\n1. Cust: Klinik Ananda\nhasil: Bertemu Ibu Isti\nnext: kirim SPH\n2. Cust: RS Panti Waluyo\nhasil: bertemu analis",
  );
  assert.deepEqual(n, ["Cust: Klinik Ananda", "Cust: RS Panti Waluyo"]);
});

test("format inline bersegmen tetap jalan", () => {
  const n = nama("#Report Ari 19/8/2026\n1. RS Al-Islam | ketemu dr Andi | demo Jumat");
  assert.deepEqual(n, ["RS Al-Islam"]);
  const it = parseAmReport("#Report Ari 19/8/2026\n1. RS Al-Islam | ketemu dr Andi | demo Jumat", NOW).items[0];
  assert.equal(it.hasil, "ketemu dr Andi");
  assert.equal(it.next_action, "demo Jumat");
});

test("hasil & next tetap menempel ke customer yang benar", () => {
  const r = parseAmReport(`${LRM}#Report Irul 18/8/2026\nrsu muh babat\nhasil: ketemu analis\nnext: kirim penawaran`, NOW);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].customer, "rsu muh babat");
  assert.equal(r.items[0].hasil, "ketemu analis");
  assert.equal(r.items[0].next_action, "kirim penawaran");
});
