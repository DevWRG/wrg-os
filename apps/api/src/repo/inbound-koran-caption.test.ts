import assert from "node:assert/strict";
import test from "node:test";

import { buildPeringatanKoranCaption, tanggalDariCaptionKoran } from "./inbound.js";

// Latar: 12 Okt 2026 renika mengirim "#koran NIAGA 09/10/2026" dengan PDF
// bertanggal 10 Okt. Balasannya berbunyi "terverifikasi" dan datanya mendarat
// di tanggal yang salah tanpa ada yang tahu — resume 9 Okt tertahan karena
// NIAGA dianggap belum masuk.

test("tanggal caption dibaca format Indonesia: hari DULU", () => {
  // 09/10/2026 = 9 Oktober, bukan 10 September.
  assert.equal(tanggalDariCaptionKoran("#koran NIAGA  09/10/2026"), "2026-10-09");
  assert.equal(tanggalDariCaptionKoran("#koran BNI 9/10/2026"), "2026-10-09");
  assert.equal(tanggalDariCaptionKoran("#koran MDR 038 09-10-2026"), "2026-10-09");
});

test("bentuk ISO juga diterima", () => {
  assert.equal(tanggalDariCaptionKoran("#koran BJTM 2026-10-09"), "2026-10-09");
});

test("caption tanpa tanggal → null, bukan tebakan", () => {
  assert.equal(tanggalDariCaptionKoran("#koran BNI"), null);
  assert.equal(tanggalDariCaptionKoran(null), null);
  // "MDR 038" dan "INDEX 131" bukan tanggal — jangan sampai terbaca sebagai itu.
  assert.equal(tanggalDariCaptionKoran("#koran MDR 038"), null);
  assert.equal(tanggalDariCaptionKoran("#koran INDEX 131"), null);
});

test("tanggal mustahil ditolak", () => {
  assert.equal(tanggalDariCaptionKoran("#koran BNI 32/10/2026"), null);
  assert.equal(tanggalDariCaptionKoran("#koran BNI 09/13/2026"), null);
});

test("caption cocok dengan dokumen → DIAM", () => {
  assert.equal(buildPeringatanKoranCaption("2026-10-09", "#koran BJTM  09/10/2026"), null);
});

test("caption BEDA dari dokumen → peringatan menyebut keduanya", () => {
  const w = buildPeringatanKoranCaption("2026-10-10", "#koran NIAGA  09/10/2026");
  assert.ok(w, "harus ada peringatan");
  assert.ok(w.includes("2026-10-09"), "sebut tanggal yang ditulis pengirim");
  assert.ok(w.includes("2026-10-10"), "sebut tanggal isi dokumen");
  assert.ok(w.includes("ekspor ulang"), "beri tahu apa yang harus dilakukan");
});

test("caption tanpa tanggal → DIAM, jangan mengarang ketidakcocokan", () => {
  assert.equal(buildPeringatanKoranCaption("2026-10-09", "#koran BNI"), null);
});
