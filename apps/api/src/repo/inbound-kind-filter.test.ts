// Penjaga paritas antara TIGA hal yang harus selalu sepakat soal daftar hashtag
// inbound WA:
//
//   1. INBOUND_HASHTAGS        — sumber tunggal (juga menurunkan tipe InboundKind)
//   2. detectKind()            — pengenal hashtag per-baris pesan
//   3. inboundHashtagPattern() — regex penjaring baris di processUnprocessed
//
// Kenapa perlu dites: dulu (2) dan (3) ditulis terpisah dan menyimpang tanpa
// suara. `bukti` ada di tipe dan dikenali detectKind, tapi HILANG dari regex
// penyaring — jadi `#BUKTI SJ-x` berupa TEKS tak pernah terpilih query sama
// sekali, padahal markBukti punya penanganan khusus untuk kasus tanpa foto.
// Yang lolos cuma #BUKTI berfoto, via klausa OR media. Bug-nya tak terlihat
// karena kurir hampir selalu melampirkan foto.
//
// Murni (tanpa DB):
//   node --test apps/api/dist/repo/inbound-kind-filter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { INBOUND_HASHTAGS, detectKind, inboundHashtagPattern } from "./inbound.js";

// Hashtag yang SENGAJA tak punya handler sendiri di processInboundMessage —
// detectKind mengembalikannya, tapi jawabannya "belum tersedia" (bukan alias
// ke kind lain). Didaftar eksplisit supaya penambahan alias baru harus sadar.
const ALIAS_DETEKSI: Partial<Record<string, string>> = {};

test("setiap hashtag di INBOUND_HASHTAGS dikenali detectKind", () => {
  for (const h of INBOUND_HASHTAGS) {
    const harap = ALIAS_DETEKSI[h] ?? h;
    assert.equal(detectKind(`#${h} argumen contoh`), harap, `#${h} tidak dikenali detectKind`);
  }
});

test("deteksi tak peduli huruf besar-kecil maupun spasi setelah #", () => {
  for (const h of INBOUND_HASHTAGS) {
    const harap = ALIAS_DETEKSI[h] ?? h;
    assert.equal(detectKind(`#${h.toUpperCase()} x`), harap, `#${h.toUpperCase()} gagal`);
    assert.equal(detectKind(`# ${h} x`), harap, `"# ${h}" gagal`);
  }
});

test("setiap hashtag yang dikenali detectKind JUGA terjaring regex penyaring", () => {
  // Ini invarian intinya: kind yang dikenali tapi tak terjaring = pesan yang
  // dibaca benar lalu dibuang diam-diam sebelum sampai ke handler-nya.
  const re = new RegExp(inboundHashtagPattern(), "i");
  for (const h of INBOUND_HASHTAGS) {
    assert.ok(re.test(`#${h} argumen contoh`), `#${h} dikenali tapi TIDAK terjaring penyaring`);
  }
});

test("regex penyaring tak menjaring teks tanpa hashtag", () => {
  const re = new RegExp(inboundHashtagPattern(), "i");
  for (const t of ["halo pak", "kirim barangnya besok ya", "sudah bast kok", "report saya menyusul"]) {
    assert.ok(!re.test(t), `"${t}" seharusnya tak terjaring`);
  }
});

test("hashtag yang tak dikenal tetap 'none'", () => {
  for (const t of ["#ticket ada kendala", "#forecast q4", "#ttf 123", "#sj 456", "#asetbaru"]) {
    assert.equal(detectKind(t), "none", `${t} seharusnya none`);
  }
});

test("daftar hashtag tak punya duplikat", () => {
  assert.equal(new Set(INBOUND_HASHTAGS).size, INBOUND_HASHTAGS.length);
});

test("hashtag dikenali walau bukan di baris pertama", () => {
  // Kurir/AM sering menulis pengantar dulu, hashtag-nya di baris bawah.
  assert.equal(detectKind("pak ini laporan hari ini\n#BUKTI SJ-2026-003"), "bukti");
  assert.equal(detectKind("mohon dicek\n\n#STOK FX80"), "stok");
});
