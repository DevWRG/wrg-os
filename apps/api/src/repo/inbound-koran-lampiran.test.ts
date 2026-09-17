// Penjaga penerimaan lampiran #KORAN (F-CASHIN).
//
// Dua kesalahan yang dites di sini dua-duanya TERJADI, bukan hipotesis —
// terlihat di grup uji 17 Sep 2026 saat setoran pertama tak dibalas sama sekali:
//
//   1. message_type PDF dari WhatsApp berbunyi 'application/pdf'. Kode lama
//      cuma menerima 'document*'/'image*', jadi lampiran PDF — bentuk ASLI
//      rekening koran dari e-banking — tak pernah lolos gerbang ini.
//   2. caption dan file datang sebagai DUA pesan ('#KORAN mandiri 17 sep'
//      pukul 23:36:24, PDF-nya 23:36:25), sehingga pesan hashtagnya sendiri
//      tak punya media_path.
//
// Murni (tanpa DB):
//   node --test apps/api/dist/repo/inbound-koran-lampiran.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { adaLampiranDokumen } from "./inbound.js";

test("PDF e-banking (application/pdf) diterima sebagai lampiran koran", () => {
  assert.equal(adaLampiranDokumen({ message_type: "application/pdf", media_path: "/m/a.pdf" }), true);
});

test("bentuk lampiran lain yang sah ikut diterima", () => {
  for (const t of ["document", "documentMessage", "image/jpeg", "imageMessage"]) {
    assert.equal(adaLampiranDokumen({ message_type: t, media_path: "/m/a" }), true, t);
  }
});

test("pesan teks #KORAN tanpa file BUKAN lampiran", () => {
  // Justru baris inilah yang dulu dibalas '⚠️ wajib disertai lampiran'
  // padahal filenya menyusul satu detik kemudian.
  assert.equal(adaLampiranDokumen({ message_type: "text", media_path: null }), false);
  // Tipe dokumen tanpa berkas juga tidak dianggap ada lampiran.
  assert.equal(adaLampiranDokumen({ message_type: "application/pdf", media_path: null }), false);
});
